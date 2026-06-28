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
  registrationId: string;
  registrationDate: Date;
  rewardType: string;        // e.g. "WARRANTY15"
  discountPercentage: number; // e.g. 15
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
  } = params;

  // Extract the legacy numeric ID from the Shopify GID so the code matches
  // the format Flow used: "WARRANTY15-12345"
  const legacyId = customerId.split("/").at(-1) ?? customerId;
  const discountCode = `${rewardType}-${legacyId}`;

  console.log(
    `${LOG} issueRewardAndNotify — shop=${shop} phone=${phone} code=${discountCode} rewardType=${rewardType}`,
  );

  // ---- 1. Create Shopify discount code ----------------------------------------

  let resolvedCode = discountCode; // may be overwritten if the code already exists

  try {
    const { admin } = await unauthenticated.admin(shop);

    const percentage = discountPercentage / 100; // Shopify expects 0–1
    const humanTitle = `${rewardType} ${discountPercentage}% discount for customer ${legacyId}`;

    const response = await admin.graphql(DISCOUNT_CREATE_MUTATION, {
      variables: {
        basicCodeDiscount: {
          title: humanTitle,
          code: discountCode,
          startsAt: new Date().toISOString(),
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
    voucherExpiryDays: 30,
    lang: "ar",
    shop,
  });

  // ---- 3. Persist SMSLog (skip on dedup — already logged on the original send) ---

  if (!smsResult.isDuplicate) {
    try {
      await prisma.sMSLog.create({
        data: {
          shop,
          phone,
          registrationId: registrationId ?? null,
          smsSent: smsResult.success,
          smsSentAt: smsResult.success ? new Date(smsResult.timestamp) : null,
          smsProviderResponse: smsResult.rawResponse ?? smsResult.error ?? null,
        },
      });
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
