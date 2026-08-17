import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { normalizePhone } from "../utils/phone.server";
import { issueRewardAndNotify } from "../services/reward.server";
import { sendGiftCardWhatsApp } from "../services/infobip.server";
import prisma from "../db.server";
import {
  resolveOrderPhone,
  saveCustomerPhone,
  type OrderPayload,
} from "../lib/webhooks.orders.paid.server";

/**
 * ORDERS_PAID webhook — fires when payment is captured on an order.
 *
 * Voucher 1 [voucher1]: order subtotal >= 100,000 IQD → 15% discount, valid 60 days.
 * Voucher 3 [voucher3]: customer's first-ever paid order → 15% next-order discount.
 *
 * Both can fire on the same order. Each path is independently wrapped so a failure
 * in one never prevents the other from running.
 *
 * Payload field notes (Shopify REST webhook format):
 *   subtotal_price       — string, order subtotal after discounts in shop currency (IQD).
 *                          Does NOT include shipping or taxes.
 *   currency             — string, always "IQD" for this store.
 *   customer.orders_count — integer, total number of orders for this customer INCLUDING
 *                          the current one. Value of 1 means this is the first paid order.
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[orders/paid] ${topic} received for shop=${shop}`);

  const order = payload as OrderPayload;

  // --- Extract order fields ---
  const subtotal = parseFloat(order.subtotal_price ?? "0");
  const currency = order.currency ?? "IQD";
  const orderId = order.id;
  const orderNumber = order.order_number ?? orderId;
  const orderDate = order.created_at ? new Date(order.created_at) : new Date();
  const productName = order.line_items?.[0]?.title ?? "Geepas product";

  // --- Check for Standalone Extended Warranty line items ---
  const warrantyLineItems = (order.line_items || []).filter((item: any) =>
    item.properties?.some((p: any) => p.name === "_protects_product_id"),
  );
  if (warrantyLineItems.length > 0) {
    for (const wItem of warrantyLineItems) {
      const protectsProductId = wItem.properties?.find(
        (p: any) => p.name === "_protects_product_id",
      )?.value;
      console.log(
        `[orders/paid] Standalone Extended Warranty detected in order ${orderNumber}: ` +
          `Title="${wItem.title}" protects ProductId=${protectsProductId}`,
      );
    }
  }

  // --- Extract customer fields ---
  const customer = order.customer;
  if (!customer) {
    console.log(
      `[orders/paid] order ${orderNumber} has no customer — skipping`,
    );
    return new Response(null, { status: 200 });
  }

  // Resolve phone: customer record first, then order-level and address fields.
  // customer.phone is null on first orders because Shopify only saves it after checkout.
  const rawPhone = resolveOrderPhone(order);
  const customerName = customer.first_name ?? "Customer";
  const customerId = `gid://shopify/Customer/${customer.id}`;
  const ordersCount = customer.orders_count ?? 0;

  console.log(
    `[orders/paid] order=${orderNumber} subtotal=${subtotal} ${currency} ` +
      `customer=${customer.id} ordersCount=${ordersCount} phone=${rawPhone || "(none)"}`,
  );

  // --- Guard: no phone means we cannot send any SMS ---
  if (!rawPhone) {
    console.log(
      `[orders/paid] customer ${customer.id} has no phone — skipping all vouchers`,
    );
    return new Response(null, { status: 200 });
  }

  const normalizedPhone = normalizePhone(rawPhone);
  if (!normalizedPhone) {
    console.log(
      `[orders/paid] customer ${customer.id} phone "${rawPhone}" failed to normalize — skipping all vouchers`,
    );
    return new Response(null, { status: 200 });
  }

  // --- Backfill phone on customer record if it was missing ---
  // Applies on first orders where Shopify leaves customer.phone null but the
  // delivery phone is present on the order/address.
  if (!customer.phone) {
    await saveCustomerPhone(shop, customerId, normalizedPhone);
  }

  // ---- Voucher logic: first order vs. repeat order (mutually exclusive) ---------
  // Shopify's ordersCount in the payload is unreliable (often 0 for repeat customers),
  // so we decide "first order" from our own DB instead.
  // A customer is a first-timer if they have never been issued SECOND15.

  let alreadyGotSecond15 = false;
  try {
    const existing = await prisma.sMSLog.findUnique({
      where: { dedupeKey: `second15:${customerId}` },
    });
    alreadyGotSecond15 = existing !== null;
  } catch (dbErr) {
    // Non-fatal: if the check fails, fall back to treating as first order (safe — dedup in
    // issueRewardAndNotify will still prevent a double SECOND15 send via the upsert).
    console.warn(
      `[orders/paid] DB check for SECOND15 threw (defaulting to first-order path):`,
      dbErr,
    );
  }

  console.log(
    `[orders/paid] ordersCount=${ordersCount} (payload, for reference only) alreadyGotSecond15=${alreadyGotSecond15}`,
  );

  if (!alreadyGotSecond15) {
    // ---- Voucher 3: first paid order → SECOND15 (15% off second order) ----------
    console.log(
      `[voucher3] no prior SECOND15 for customer ${customer.id} — issuing SECOND15`,
    );
    try {
      const result = await issueRewardAndNotify({
        shop,
        customerId,
        phone: normalizedPhone,
        customerName,
        productName,
        registrationId: `order-${orderId}-second15`,
        registrationDate: orderDate,
        rewardType: "SECOND15",
        discountPercentage: 15,
        expiryDays: 60,
        dedupeKey: `second15:${customerId}`,
      });
      if (result.success) {
        console.log(
          `[voucher3] reward issued — code=${result.discountCode} messageId=${result.messageId}`,
        );
      } else {
        console.error(
          `[voucher3] issueRewardAndNotify failed for order ${orderNumber}:`,
          result.error,
        );
      }
    } catch (err) {
      console.error(
        `[voucher3] issueRewardAndNotify threw for order ${orderNumber}:`,
        err,
      );
    }
  } else {
    // ---- Voucher 1: repeat customer, subtotal >= 100,000 IQD → NEXT15 -----------
    if (subtotal >= 100000) {
      console.log(
        `[voucher1] subtotal ${subtotal} ${currency} >= 100000 — issuing NEXT15 for customer ${customer.id}`,
      );
      try {
        const result = await issueRewardAndNotify({
          shop,
          customerId,
          phone: normalizedPhone,
          customerName,
          productName,
          registrationId: `order-${orderId}-next15`,
          registrationDate: orderDate,
          rewardType: "NEXT15",
          discountPercentage: 15,
          expiryDays: 60,
          dedupeKey: `next15:${orderId}`,
        });
        if (result.success) {
          console.log(
            `[voucher1] reward issued — code=${result.discountCode} messageId=${result.messageId}`,
          );
        } else {
          console.error(
            `[voucher1] issueRewardAndNotify failed for order ${orderNumber}:`,
            result.error,
          );
        }
      } catch (err) {
        console.error(
          `[voucher1] issueRewardAndNotify threw for order ${orderNumber}:`,
          err,
        );
      }
    } else {
      console.log(
        `[voucher1] subtotal ${subtotal} ${currency} < 100000 — skipping NEXT15`,
      );
    }
  }

  // ---- Single-use Gift Cards: Deactivate used gift cards immediately -----------
  try {
    const orderId = order.id;
    // Fetch the transactions using the Admin client to find used gift cards
    const { admin } = await unauthenticated.admin(shop);

    const transactionsQuery = `#graphql
      query getOrderTransactions($id: ID!) {
        order(id: $id) {
          transactions {
            gateway
            receiptJson
          }
        }
      }
    `;
    const response = await admin.graphql(transactionsQuery, {
      variables: { id: `gid://shopify/Order/${orderId}` },
    });
    const data = (await response.json()) as any;
    const transactions = data?.data?.order?.transactions ?? [];

    for (const tx of transactions) {
      let giftCardId: string | null = null;

      if (
        tx.gateway === "gift_card" ||
        tx.gateway?.toLowerCase().includes("gift_card")
      ) {
        // Parse receiptJson if present
        if (tx.receiptJson) {
          try {
            const receipt =
              typeof tx.receiptJson === "string"
                ? JSON.parse(tx.receiptJson)
                : tx.receiptJson;
            const rawId =
              receipt.gift_card_id ?? receipt.giftCardId ?? receipt.id;
            if (rawId) {
              giftCardId = String(rawId).startsWith("gid://")
                ? String(rawId)
                : `gid://shopify/GiftCard/${rawId}`;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      // Fallback check if receiptJson contained gift_card_id directly
      if (!giftCardId && tx.receiptJson) {
        try {
          const receipt =
            typeof tx.receiptJson === "string"
              ? JSON.parse(tx.receiptJson)
              : tx.receiptJson;
          const rawId = receipt.gift_card_id ?? receipt.giftCardId;
          if (rawId) {
            giftCardId = String(rawId).startsWith("gid://")
              ? String(rawId)
              : `gid://shopify/GiftCard/${rawId}`;
          }
        } catch (e) {}
      }

      // If we identified a used gift card, deactivate it immediately
      if (giftCardId) {
        console.log(`[orders/paid] Deactivating used gift card: ${giftCardId}`);
        const deactivateMutation = `#graphql
          mutation giftCardDeactivate($id: ID!) {
            giftCardDeactivate(id: $id) {
              giftCard {
                id
                deactivatedAt
              }
              userErrors {
                message
                field
                code
              }
            }
          }
        `;
        const deactivateResponse = await admin.graphql(deactivateMutation, {
          variables: { id: giftCardId },
        });
        const deactivateData = (await deactivateResponse.json()) as any;
        const errors =
          deactivateData?.data?.giftCardDeactivate?.userErrors ?? [];
        if (errors.length > 0) {
          console.error(
            `[orders/paid] Failed to deactivate gift card ${giftCardId}:`,
            errors.map((e: any) => e.message).join(", "),
          );
        } else {
          console.log(
            `[orders/paid] Successfully deactivated gift card ${giftCardId}`,
          );
        }
      }
    }
  } catch (err) {
    console.error(
      `[orders/paid] Error processing single-use gift cards deactivation:`,
      err,
    );
  }

  // ---- Gift Card WhatsApp Notification ------------------------------------
  // Shopify does not support a gift_cards/create webhook topic, so we detect
  // gift card purchases here from line items and notify the recipient via WhatsApp.
  try {
    // --- DEBUG: log raw line items to understand what Shopify sends ---
    const rawLineItems = order.line_items ?? [];
    console.log(
      `[giftcard-wa] DEBUG order=${orderNumber} line_items count=${rawLineItems.length}:\n` +
        rawLineItems
          .map(
            (li, i) =>
              `  [${i}] title=${li.title ?? "(none)"} is_gift_card=${(li as any).is_gift_card} ` +
              `gift_card=${(li as any).gift_card} product_id=${(li as any).product_id ?? "?"} ` +
              `properties=${JSON.stringify(li.properties ?? [])}`,
          )
          .join("\n"),
    );

    // Detect gift card line items using multiple strategies:
    // 1. is_gift_card === true (standard field)
    // 2. gift_card === true (alternative field name some API versions use)
    // 3. product_type === "gift_card" (not always present in webhook)
    const giftCardLineItems = rawLineItems.filter(
      (li) =>
        (li as any).is_gift_card === true || (li as any).gift_card === true,
    );

    console.log(
      `[giftcard-wa] Detected ${giftCardLineItems.length} gift card line item(s) via is_gift_card/gift_card flag`,
    );

    // If no gift card line items detected, still try to query in case the flag
    // is missing from the payload (Shopify sometimes omits false-y fields).
    // We'll query the giftCards API regardless and let the result count decide.
    const shouldQuery = giftCardLineItems.length > 0 || customer.id != null;

    if (!shouldQuery) {
      console.log(
        `[giftcard-wa] No customer ID available — skipping gift card query`,
      );
    } else {
      const { admin } = await unauthenticated.admin(shop);

      // Query gift cards created in the last 15 minutes for this customer.
      // The datetime value MUST be quoted in Shopify's search syntax —
      // unquoted ISO timestamps break because colons in "18:04:48" are
      // treated as field separators, making the filter effectively ignored.
      const windowStart = new Date(Date.now() - 15 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"); // strip milliseconds (e.g. ".757Z" → "Z")
      const queryStr = `customer_id:${customer.id} created_at:>="${windowStart}"`;
      console.log(`[giftcard-wa] Querying giftCards API — query="${queryStr}"`);

      const giftCardsQuery = `#graphql
        query getRecentGiftCards($query: String!, $first: Int!) {
          giftCards(first: $first, query: $query) {
            edges {
              node {
                id
                maskedCode
                lastCharacters
                initialValue {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      `;

      const giftCardsResponse = await admin.graphql(giftCardsQuery, {
        variables: { query: queryStr, first: 10 },
      });
      const giftCardsData = (await giftCardsResponse.json()) as any;

      // Log raw GraphQL response for debugging
      console.log(
        `[giftcard-wa] giftCards GraphQL raw response:\n${JSON.stringify(giftCardsData, null, 2)}`,
      );

      const giftCardEdges = giftCardsData?.data?.giftCards?.edges ?? [];
      console.log(
        `[giftcard-wa] Found ${giftCardEdges.length} recently issued gift card(s) for customer ${customer.id}`,
      );

      // If no gift cards found and we didn't detect gift card line items, skip.
      if (giftCardEdges.length === 0) {
        console.log(
          `[giftcard-wa] No recent gift cards found for customer ${customer.id} — skipping WhatsApp notification`,
        );
      }

      for (const edge of giftCardEdges) {
        const gc = edge.node;
        const gcId = gc.id;
        const gcCode =
          gc.maskedCode ??
          (gc.lastCharacters ? `••••${gc.lastCharacters}` : "");
        const gcAmount = gc.initialValue?.amount ?? "0";
        const gcCurrency = gc.initialValue?.currencyCode ?? "IQD";
        const amountFormatted = `${parseFloat(gcAmount).toLocaleString()} ${gcCurrency}`;

        console.log(
          `[giftcard-wa] Processing gift card: id=${gcId} code=${gcCode} amount=${amountFormatted}`,
        );

        // --- Resolve recipient phone ---
        let gcRecipientPhone = "";
        let gcRecipientName = customerName;

        // Priority 1: Check REST line item properties (webhook payload)
        for (const li of rawLineItems) {
          const props = li.properties ?? [];
          console.log(
            `[giftcard-wa] line item "${li.title}" properties: ${JSON.stringify(props)}`,
          );
          const phoneProp = props.find(
            (p) => p.name === "Recipient Phone" || p.name === "recipient_phone",
          );
          const nameProp = props.find(
            (p) => p.name === "Recipient name" || p.name === "recipient_name",
          );
          if (phoneProp?.value) {
            gcRecipientPhone = phoneProp.value;
            console.log(
              `[giftcard-wa] Resolved phone from REST line item property: ${gcRecipientPhone}`,
            );
          }
          if (nameProp?.value) {
            gcRecipientName = nameProp.value;
            console.log(
              `[giftcard-wa] Resolved name from REST line item property: ${gcRecipientName}`,
            );
          }
        }

        // Priority 2: Fallback — use the buyer's own phone
        if (!gcRecipientPhone) {
          gcRecipientPhone = normalizedPhone;
          gcRecipientName = customerName;
          console.log(
            `[giftcard-wa] Falling back to buyer's phone: ${gcRecipientPhone}`,
          );
        }

        const normalizedGcPhone = normalizePhone(gcRecipientPhone);
        console.log(
          `[giftcard-wa] normalizedGcPhone="${normalizedGcPhone ?? "(invalid)"}"`,
        );

        if (!normalizedGcPhone) {
          console.warn(
            `[giftcard-wa] Gift card ${gcId}: phone "${gcRecipientPhone}" failed normalization — skipping WhatsApp`,
          );
          continue;
        }

        // Dedupe key: one notification per gift card
        const dedupeKey = `giftcard-wa:${gcId.split("/").pop()}`;

        console.log(
          `[giftcard-wa] Sending WhatsApp to ${normalizedGcPhone} — ` +
            `code=${gcCode} name=${gcRecipientName} amount=${amountFormatted}`,
        );

        const gcResult = await sendGiftCardWhatsApp({
          phoneNumber: normalizedGcPhone,
          recipientName: gcRecipientName,
          amountFormatted,
          maskedCode: gcCode,
          shop,
          giftCardId: gcId,
          dedupeKey,
        });

        console.log(
          `[giftcard-wa] sendGiftCardWhatsApp result: success=${gcResult.success} ` +
            `isDuplicate=${gcResult.isDuplicate} error=${gcResult.error ?? "(none)"} ` +
            `messageId=${gcResult.messageId ?? "(none)"}`,
        );

        // Log to SMSLog (upsert by dedupeKey to be idempotent on webhook retries)
        if (!gcResult.isDuplicate) {
          try {
            await prisma.sMSLog.upsert({
              where: { dedupeKey },
              create: {
                shop,
                phone: normalizedGcPhone,
                registrationId: null,
                smsSent: gcResult.success,
                smsSentAt: gcResult.success
                  ? new Date(gcResult.timestamp)
                  : null,
                smsProviderResponse:
                  gcResult.rawResponse ?? gcResult.error ?? null,
                dedupeKey,
              },
              update: {
                smsSent: gcResult.success,
                smsSentAt: gcResult.success
                  ? new Date(gcResult.timestamp)
                  : null,
                smsProviderResponse:
                  gcResult.rawResponse ?? gcResult.error ?? null,
              },
            });
          } catch (dbErr) {
            console.error(
              `[giftcard-wa] Failed to write SMSLog for gift card ${gcId}:`,
              dbErr,
            );
          }
        }
      }
    }
  } catch (err) {
    console.error(
      `[giftcard-wa] Unhandled error in gift card WhatsApp notification block:`,
      err,
    );
  }

  return new Response(null, { status: 200 });
};
