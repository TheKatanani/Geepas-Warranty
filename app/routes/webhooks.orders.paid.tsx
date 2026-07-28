import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { normalizePhone } from "../utils/phone.server";
import { issueRewardAndNotify } from "../services/reward.server";
import { sendWhatsAppTemplate } from "../services/infobip.server";
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

  // --- Extract customer fields ---
  const customer = order.customer;
  if (!customer) {
    console.log(`[orders/paid] order ${orderNumber} has no customer — skipping`);
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
    console.log(`[orders/paid] customer ${customer.id} has no phone — skipping all vouchers`);
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
    console.warn(`[orders/paid] DB check for SECOND15 threw (defaulting to first-order path):`, dbErr);
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
      console.error(`[voucher3] issueRewardAndNotify threw for order ${orderNumber}:`, err);
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
        console.error(`[voucher1] issueRewardAndNotify threw for order ${orderNumber}:`, err);
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
      variables: { id: `gid://shopify/Order/${orderId}` }
    });
    const data = (await response.json()) as any;
    const transactions = data?.data?.order?.transactions ?? [];
    
    for (const tx of transactions) {
      let giftCardId: string | null = null;
      
      if (tx.gateway === "gift_card" || tx.gateway?.toLowerCase().includes("gift_card")) {
        // Parse receiptJson if present
        if (tx.receiptJson) {
          try {
            const receipt = typeof tx.receiptJson === "string" ? JSON.parse(tx.receiptJson) : tx.receiptJson;
            const rawId = receipt.gift_card_id ?? receipt.giftCardId ?? receipt.id;
            if (rawId) {
              giftCardId = String(rawId).startsWith("gid://") ? String(rawId) : `gid://shopify/GiftCard/${rawId}`;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
      
      // Fallback check if receiptJson contained gift_card_id directly
      if (!giftCardId && tx.receiptJson) {
        try {
          const receipt = typeof tx.receiptJson === "string" ? JSON.parse(tx.receiptJson) : tx.receiptJson;
          const rawId = receipt.gift_card_id ?? receipt.giftCardId;
          if (rawId) {
            giftCardId = String(rawId).startsWith("gid://") ? String(rawId) : `gid://shopify/GiftCard/${rawId}`;
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
          variables: { id: giftCardId }
        });
        const deactivateData = (await deactivateResponse.json()) as any;
        const errors = deactivateData?.data?.giftCardDeactivate?.userErrors ?? [];
        if (errors.length > 0) {
          console.error(
            `[orders/paid] Failed to deactivate gift card ${giftCardId}:`,
            errors.map((e: any) => e.message).join(", ")
          );
        } else {
          console.log(`[orders/paid] Successfully deactivated gift card ${giftCardId}`);
        }
      }
    }
  } catch (err) {
    console.error(`[orders/paid] Error processing single-use gift cards deactivation:`, err);
  }

  // ---- Gift Card WhatsApp Notification ------------------------------------
  // Shopify does not support a gift_cards/create webhook topic, so we detect
  // gift card purchases here from line items and notify the recipient via WhatsApp.
  try {
    const giftCardLineItems = (order.line_items ?? []).filter((li) => li.is_gift_card === true);
    if (giftCardLineItems.length > 0) {
      console.log(`[orders/paid] Order ${orderNumber} contains ${giftCardLineItems.length} gift card line item(s) — querying issued gift cards`);

      const { admin } = await unauthenticated.admin(shop);

      // Query gift cards created in the last 10 minutes for this customer
      const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const giftCardsQuery = `#graphql
        query getRecentGiftCards($query: String!, $first: Int!) {
          giftCards(first: $first, query: $query) {
            edges {
              node {
                id
                code
                maskedCode
                initialValue {
                  amount
                  currencyCode
                }
                lineItem {
                  id
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      `;

      // Filter by customer and recent creation time
      const queryStr = `customer_id:${customer.id} created_at:>=${windowStart}`;
      const giftCardsResponse = await admin.graphql(giftCardsQuery, {
        variables: { query: queryStr, first: 10 },
      });
      const giftCardsData = (await giftCardsResponse.json()) as any;
      const giftCardEdges = giftCardsData?.data?.giftCards?.edges ?? [];

      console.log(`[orders/paid] Found ${giftCardEdges.length} recently issued gift card(s) for customer ${customer.id}`);

      for (const edge of giftCardEdges) {
        const gc = edge.node;
        const gcId = gc.id;
        const gcCode = gc.code ?? gc.maskedCode ?? "";
        const gcAmount = gc.initialValue?.amount ?? "0";
        const gcCurrency = gc.initialValue?.currencyCode ?? "IQD";
        const amountFormatted = `${parseFloat(gcAmount).toLocaleString()} ${gcCurrency}`;

        // Try to get recipient phone from line item custom attributes
        let gcRecipientPhone = "";
        let gcRecipientName = customerName;
        const customAttrs: Array<{ key: string; value: string }> = gc.lineItem?.customAttributes ?? [];
        const phoneAttr = customAttrs.find(
          (a) => a.key === "Recipient Phone" || a.key === "recipient_phone"
        );
        const nameAttr = customAttrs.find(
          (a) => a.key === "Recipient name" || a.key === "recipient_name"
        );
        if (phoneAttr?.value) gcRecipientPhone = phoneAttr.value;
        if (nameAttr?.value) gcRecipientName = nameAttr.value;

        // Also check the REST line item properties for recipient phone (webhook payload)
        if (!gcRecipientPhone) {
          // Search all gift card line items in the order payload
          for (const li of giftCardLineItems) {
            const phoneProp = (li.properties ?? []).find(
              (p) => p.name === "Recipient Phone" || p.name === "recipient_phone"
            );
            const nameProp = (li.properties ?? []).find(
              (p) => p.name === "Recipient name" || p.name === "recipient_name"
            );
            if (phoneProp?.value) {
              gcRecipientPhone = phoneProp.value;
            }
            if (nameProp?.value && gcRecipientName === customerName) {
              gcRecipientName = nameProp.value;
            }
          }
        }

        // Fallback: use buyer's phone
        if (!gcRecipientPhone) {
          gcRecipientPhone = normalizedPhone;
          gcRecipientName = customerName;
        }

        const normalizedGcPhone = normalizePhone(gcRecipientPhone);
        if (!normalizedGcPhone) {
          console.warn(`[orders/paid] Gift card ${gcId}: phone "${gcRecipientPhone}" failed normalization — skipping WhatsApp`);
          continue;
        }

        // Dedupe key: one notification per gift card
        const dedupeKey = `giftcard-wa:${gcId.split("/").pop()}`;
        const placeholders = [
          gcRecipientName,    // {{1}}
          amountFormatted,    // {{2}}
          gcCode,             // {{3}}
          gcRecipientName,    // {{4}}
          amountFormatted,    // {{5}}
          gcCode,             // {{6}}
        ];

        console.log(`[orders/paid] Sending gift card WhatsApp to ${normalizedGcPhone} for card ${gcId}`);
        const gcResult = await sendWhatsAppTemplate({
          phoneNumber: normalizedGcPhone,
          templateName: "gift_card_notification",
          placeholders,
          shop,
          registrationId: `giftcard-${gcId.split("/").pop()}`,
          dedupeKey,
        });

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
                smsSentAt: gcResult.success ? new Date(gcResult.timestamp) : null,
                smsProviderResponse: gcResult.rawResponse ?? gcResult.error ?? null,
                dedupeKey,
              },
              update: {
                smsSent: gcResult.success,
                smsSentAt: gcResult.success ? new Date(gcResult.timestamp) : null,
                smsProviderResponse: gcResult.rawResponse ?? gcResult.error ?? null,
              },
            });
          } catch (dbErr) {
            console.error(`[orders/paid] Failed to write SMSLog for gift card ${gcId}:`, dbErr);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[orders/paid] Error sending gift card WhatsApp notifications:`, err);
  }

  return new Response(null, { status: 200 });
};
