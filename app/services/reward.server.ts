/**
 * Reward engine — creates a Shopify discount code and sends the SMS in one shot.
 *
 * Replaces the Shopify Flow dependency: Flow's "Send HTTP request" action is
 * unavailable on the store's current plan, so the app now handles the full
 * discount + SMS pipeline itself.
 *
 * Design:
 *   1. discountCodeBasicCreate  — Admin GraphQL (requires write_discounts scope)
 *   2. sendWarrantySms          — reused from app/services/infobip.server.ts
 *   3. CustomerReward upsert    — same upsert the webhook route uses
 */

import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendWarrantySms } from "./infobip.server";

// ---- Types ------------------------------------------------------------------

export interface IssueRewardParams {
  shop: string;
  customerId: string;        // Shopify GID e.g. "gid://shopify/Customer/12345"
  phone: string;             // already E.164-normalized
  customerName: string;
  productName: string;
  registrationId: string;    // used in SMS message content; NOT written to SMSLog FK for order sends
  registrationDate: Date;
  rewardType: string;        // e.g. "WARRANTY15", "WELCOME10", "NEXT15", "SECOND15"
  discountPercentage: number; // e.g. 15, 10
  expiryDays?: number;       // days until discount expires; default 60
  dedupeKey?: string;        // stable idempotency key for order-triggered sends (e.g. "second15:<customerId>")
                             // when set: SMSLog.registrationId is stored as null (no FK), dedup checked before send
}

export interface IssueRewardResult {
  success: boolean;
  discountCode?: string;
  messageId?: string;
  error?: string;
}

// ---- GraphQL mutation -------------------------------------------------------

const DISCOUNT_CREATE_MUTATION = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              edges {
                node { code }
              }
            }
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// ---- Main export ------------------------------------------------------------

export async function issueRewardAndNotify(
  params: IssueRewardParams,
): Promise<IssueRewardResult> {
  const LOG = "[reward]";
  const {
    shop,
    customerId,
    phone,
    customerName,
    productName,
    registrationId,
    registrationDate,
    rewardType,
    discountPercentage,
    expiryDays = 60,
    dedupeKey,
  } = params;

  // Extract the legacy numeric ID from the Shopify GID so the code matches
  // the format Flow used: "WARRANTY15-12345"
  const legacyId = customerId.split("/").at(-1) ?? customerId;
  const discountCode = `${rewardType}-${legacyId}`;

  console.log(
    `${LOG} issueRewardAndNotify — shop=${shop} phone=${phone} code=${discountCode} rewardType=${rewardType}` +
    (dedupeKey ? ` dedupeKey=${dedupeKey}` : ""),
  );

  // ---- 0. Dedup check for order-triggered sends --------------------------------
  // For warranty-registration sends (no dedupeKey) the Infobip service handles
  // dedup via SMSLog.smsSentAt window. For order sends we use the stable dedupeKey
  // so dedup survives across restarts and multiple early-order webhook deliveries.

  if (dedupeKey) {
    try {
      const existing = await prisma.sMSLog.findUnique({ where: { dedupeKey } });
      if (existing) {
        console.log(`${LOG} duplicate ${dedupeKey} — skipping SMS (already sent)`);
        return { success: true, discountCode, messageId: undefined };
      }
    } catch (dedupErr) {
      // Non-fatal: if the check fails, proceed rather than block the send.
      console.warn(`${LOG} dedup check threw (proceeding):`, dedupErr);
    }
  }

  // ---- 1. Create Shopify discount code ----------------------------------------

  let resolvedCode = discountCode; // may be overwritten if the code already exists

  try {
    const { admin } = await unauthenticated.admin(shop);

    const percentage = discountPercentage / 100; // Shopify expects 0–1
    const humanTitle = `${rewardType} ${discountPercentage}% discount for customer ${legacyId}`;
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

    const response = await admin.graphql(DISCOUNT_CREATE_MUTATION, {
      variables: {
        basicCodeDiscount: {
          title: humanTitle,
          code: discountCode,
          startsAt,
          endsAt,
          customerSelection: {
            customers: {
              add: [customerId],
            },
          },
          customerGets: {
            value: { percentage },
            items: { all: true },
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
          // Hard-set: these vouchers never combine with other discounts.
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
        },
      },
    });

    const data = await response.json();
    const userErrors: Array<{ field: string[]; message: string; code: string }> =
      data?.data?.discountCodeBasicCreate?.userErrors ?? [];

    if (userErrors.length > 0) {
      // TAKEN means this exact code was already created (e.g. a previous attempt
      // succeeded but the request timed out before we logged it). Treat as success
      // and proceed with the same code — the customer is entitled to it.
      const isTaken = userErrors.some(
        (e) => e.code === "TAKEN" || e.message.toLowerCase().includes("already been taken"),
      );

      if (isTaken) {
        console.warn(
          `${LOG} discount code "${discountCode}" already exists — reusing it`,
        );
        // resolvedCode stays as discountCode
      } else {
        const msg = userErrors.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ");
        console.error(`${LOG} discountCodeBasicCreate userErrors:`, msg);
        return { success: false, error: `Discount creation failed: ${msg}` };
      }
    } else {
      // Confirm the code that Shopify stored (should equal discountCode, but trust the response)
      const storedCode =
        data?.data?.discountCodeBasicCreate?.codeDiscountNode?.codeDiscount?.codes
          ?.edges?.[0]?.node?.code;
      if (storedCode) {
        resolvedCode = storedCode;
      }
      console.log(`${LOG} discount created — code="${resolvedCode}"`);
    }
  } catch (discountErr: any) {
    console.error(`${LOG} discount creation threw:`, discountErr);
    return {
      success: false,
      error: `Discount creation error: ${discountErr?.message ?? discountErr}`,
    };
  }

  // ---- 2. Send SMS (reusing existing service — timeout, DB dedup, ACCEPTED) ------

  const smsResult = await sendWarrantySms({
    phoneNumber: phone,
    customerName,
    voucherCode: resolvedCode,
    productName,
    warrantyDays: 365,
    registrationId,
    registrationDate,
    voucherExpiryDays: expiryDays,
    lang: "ar",
    shop,
  });

  // ---- 3. Persist SMSLog (skip on dedup — already logged on the original send) ---

  if (!smsResult.isDuplicate) {
    try {
      // For order-triggered sends (dedupeKey set): registrationId must be null —
      // the synthetic "order-xxx-second15" string is not a WarrantyRegistration PK
      // and would violate the FK constraint even though the column is nullable.
      const smsLogRegistrationId = dedupeKey ? null : (registrationId ?? null);

      if (dedupeKey) {
        // Use upsert so a race between two webhook deliveries can't double-insert.
        await prisma.sMSLog.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            shop,
            phone,
            registrationId: null,
            dedupeKey,
            smsSent: smsResult.success,
            smsSentAt: smsResult.success ? new Date(smsResult.timestamp) : null,
            smsProviderResponse: smsResult.rawResponse ?? smsResult.error ?? null,
          },
        });
      } else {
        await prisma.sMSLog.create({
          data: {
            shop,
            phone,
            registrationId: smsLogRegistrationId,
            smsSent: smsResult.success,
            smsSentAt: smsResult.success ? new Date(smsResult.timestamp) : null,
            smsProviderResponse: smsResult.rawResponse ?? smsResult.error ?? null,
          },
        });
      }
    } catch (logErr) {
      console.error(`${LOG} SMSLog write failed (non-fatal):`, logErr);
    }
  }

  if (!smsResult.success && !smsResult.isDuplicate) {
    console.error(`${LOG} SMS failed for ${phone}:`, smsResult.error);
    // Discount already exists — report partial success so the caller can surface
    // the failure in logs without rolling back the discount.
    return {
      success: false,
      discountCode: resolvedCode,
      error: `Discount created but SMS failed: ${smsResult.error}`,
    };
  }

  if (smsResult.isDuplicate) {
    console.warn(`${LOG} dedup fired — SMS already sent to ${phone} recently`);
  } else {
    console.log(`${LOG} SMS sent — messageId=${smsResult.messageId}`);
  }

  // ---- 4. Upsert CustomerReward (same upsert the webhook used) -----------------

  if (!smsResult.isDuplicate) {
    try {
      await prisma.customerReward.upsert({
        where: {
          shop_phone_rewardType: { shop, phone, rewardType },
        },
        update: {
          discountCode: resolvedCode,
          sentAt: new Date(),
        },
        create: {
          shop,
          phone,
          customerId,
          rewardType,
          discountCode: resolvedCode,
          sentAt: new Date(),
        },
      });
      console.log(
        `${LOG} CustomerReward upserted — phone=${phone} rewardType=${rewardType}`,
      );
    } catch (rewardErr) {
      // Non-fatal — customer has their code and received the SMS.
      console.error(`${LOG} CustomerReward upsert failed (non-fatal):`, rewardErr);
    }
  }

  return {
    success: true,
    discountCode: resolvedCode,
    messageId: smsResult.messageId,
  };
}
