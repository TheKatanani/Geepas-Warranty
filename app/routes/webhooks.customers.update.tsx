import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendWarrantySms } from "../services/infobip.server";
import { normalizePhone } from "../utils/twilio.server";

/**
 * CUSTOMERS_UPDATE webhook — fires every time Shopify updates a customer record,
 * including when Shopify Flow adds the "voucher-ready:<TIER>:<CODE>" tag.
 *
 * Flow tag format:  voucher-ready:WARRANTY15:WARRANTY15-12345678
 *                   voucher-ready:WELCOME10:WELCOME10-12345678
 *
 * This handler:
 *  1. Detects the voucher-ready tag on the incoming payload
 *  2. Sends an SMS via Infobip with the embedded discount code
 *  3. Logs the result to SMSLog
 *  4. Removes the voucher-ready tag from the customer so it won't re-fire
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[${topic}] received for shop=${shop}`);

  const raw = payload as {
    id: number;
    first_name?: string;
    phone?: string;
    tags?: string;
  };

  const tags = (raw.tags ?? "")
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  const voucherTag = tags.find((t) => t.startsWith("voucher-ready:"));

  if (!voucherTag) {
    // Not a voucher update — nothing to do
    return new Response(null, { status: 200 });
  }

  const parts = voucherTag.split(":");
  if (parts.length !== 3) {
    console.warn(`[${topic}] Malformed voucher tag "${voucherTag}" — skipping`);
    return new Response(null, { status: 200 });
  }

  const [, , discountCode] = parts;
  const customerPhone = raw.phone ?? "";
  const firstName = raw.first_name ?? "Customer";

  if (!customerPhone) {
    console.warn(`[${topic}] Customer ${raw.id} has no phone — cannot send SMS`);
    return new Response(null, { status: 200 });
  }

  const normalizedPhone = normalizePhone(customerPhone);
  console.log(`[${topic}] Sending voucher SMS to ${normalizedPhone} code=${discountCode}`);

  // Look up the most recent warranty registration for this phone to populate SMS fields
  const registration = await prisma.warrantyRegistration.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { createdAt: "desc" },
    include: { products: true },
  });

  const productName = registration?.products?.[0]?.productTitle ?? "Geepas product";
  const warrantyDays = 365;
  const registrationId = registration?.id ?? `cust-${raw.id}`;
  const registrationDate = registration?.createdAt ?? new Date();

  const result = await sendWarrantySms({
    phoneNumber: normalizedPhone,
    customerName: firstName,
    voucherCode: discountCode,
    productName,
    warrantyDays,
    registrationId,
    registrationDate,
    voucherExpiryDays: 30,
    lang: "ar",
  });

  // Persist SMS log
  try {
    await prisma.sMSLog.create({
      data: {
        shop,
        phone: normalizedPhone,
        registrationId: registration?.id ?? null,
        smsSent: result.success,
        smsSentAt: result.success ? new Date(result.timestamp) : null,
        smsProviderResponse: result.rawResponse ?? result.error ?? null,
      },
    });
  } catch (dbErr) {
    console.error(`[${topic}] SMSLog write failed (non-fatal):`, dbErr);
  }

  if (!result.success) {
    console.error(`[${topic}] SMS failed for ${normalizedPhone}:`, result.error);
    // Return 200 — Shopify won't retry on app-level errors and we've logged it.
    // The voucher-ready tag is intentionally left on the customer so a manual
    // retry (or future cron) can pick it up.
    return new Response(null, { status: 200 });
  }

  console.log(`[${topic}] SMS sent. messageId=${result.messageId}`);

  // Create CustomerReward now that the discount code exists.
  // This is intentionally done after SMS succeeds — if SMS fails we leave
  // the tag in place so the send can be retried without issuing a duplicate reward.
  try {
    const [, tier, code] = voucherTag.split(":");
    await prisma.customerReward.upsert({
      where: {
        shop_phone_rewardType: {
          shop,
          phone: normalizedPhone,
          rewardType: tier,
        },
      },
      update: {
        discountCode: code,
        sentAt: new Date(),
      },
      create: {
        shop,
        phone: normalizedPhone,
        customerId: `gid://shopify/Customer/${raw.id}`,
        rewardType: tier,
        discountCode: code,
        sentAt: new Date(),
      },
    });
    console.log(`[${topic}] CustomerReward upserted for ${normalizedPhone} tier=${tier} code=${code}`);
  } catch (rewardErr) {
    // Non-fatal — customer received their SMS and code. Log and continue.
    console.error(`[${topic}] CustomerReward upsert failed (non-fatal):`, rewardErr);
  }

  // Remove the voucher-ready tag so this webhook doesn't re-trigger on the
  // next customer update
  const remainingTags = tags.filter((t) => t !== voucherTag);

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id tags }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: `gid://shopify/Customer/${raw.id}`,
            tags: remainingTags,
          },
        },
      },
    );
    const data = await response.json();
    const errors = data?.data?.customerUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      console.error(`[${topic}] Failed to remove voucher tag:`, errors);
    } else {
      console.log(`[${topic}] Removed tag "${voucherTag}" from customer ${raw.id}`);
    }
  } catch (err) {
    console.error(`[${topic}] Tag removal error (non-fatal):`, err);
  }

  return new Response(null, { status: 200 });
};
