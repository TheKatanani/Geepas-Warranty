import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { normalizePhone } from "../utils/twilio.server";
import { issueRewardAndNotify } from "../services/reward.server";

const LOG = "[voucher2]";

/**
 * CUSTOMERS_CREATE webhook — fires when a new customer record is created in Shopify.
 *
 * Voucher 2: first-time storefront signup → 10% welcome discount, valid 60 days.
 *
 * Guard: customers created by our own warranty flow already have the tag
 * "warranty-registered" on creation. Skip those — they get their voucher via
 * the WARRANTY15 path in api.warranty.tsx, not here.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`${LOG} ${topic} received for shop=${shop}`);

  const raw = payload as {
    id: number;
    first_name?: string;
    phone?: string;
    tags?: string;
  };

  // --- Guard: skip app-created customers (warranty-registered tag present at creation) ---
  const tags = (raw.tags ?? "")
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  if (tags.includes("warranty-registered")) {
    console.log(
      `${LOG} skipped (app-created) — customer ${raw.id} already has warranty-registered tag`,
    );
    return new Response(null, { status: 200 });
  }

  // --- Guard: no phone means we cannot send SMS ---
  const rawPhone = raw.phone ?? "";
  if (!rawPhone) {
    console.log(`${LOG} no phone — customer ${raw.id} skipped`);
    return new Response(null, { status: 200 });
  }

  const normalizedPhone = normalizePhone(rawPhone);
  const customerName = raw.first_name ?? "Customer";
  const customerId = `gid://shopify/Customer/${raw.id}`;

  console.log(
    `${LOG} eligible — customer ${raw.id} phone=${normalizedPhone} name="${customerName}"`,
  );

  // Fire-and-forget: errors are logged but never surface to Shopify (always 200).
  issueRewardAndNotify({
    shop,
    customerId,
    phone: normalizedPhone,
    customerName,
    productName: "Geepas",
    registrationId: `welcome-${raw.id}`,
    registrationDate: new Date(),
    rewardType: "WELCOME10",
    discountPercentage: 10,
    expiryDays: 60,
  }).then((result) => {
    if (result.success) {
      console.log(
        `${LOG} reward issued — code=${result.discountCode} messageId=${result.messageId}`,
      );
    } else {
      console.error(
        `${LOG} issueRewardAndNotify failed for customer ${raw.id}:`,
        result.error,
      );
    }
  }).catch((err) => {
    console.error(`${LOG} issueRewardAndNotify threw for customer ${raw.id}:`, err);
  });

  return new Response(null, { status: 200 });
};
