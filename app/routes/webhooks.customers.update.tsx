import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { sendWhatsappTemplate } from "../lib/whatsapp.server";

// Maps the TIER portion of a "voucher-ready:TIER:CODE" tag to a WhatsApp template name.
const TIER_TO_TEMPLATE: Record<string, string> = {
  WELCOME10: "welcome_voucher",
  WARRANTY15: "warranty_voucher",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[${topic}] webhook received for ${shop}`);

  const customer = payload as {
    id: number;
    first_name?: string;
    phone?: string;
    tags?: string;
  };

  console.log(`[${topic}] customer ${customer.id} tags: "${customer.tags}"`);

  const tags: string[] = (customer.tags ?? "")
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  // Find first "voucher-ready:TIER:CODE" tag
  const voucherTag = tags.find((t) => t.startsWith("voucher-ready:"));
  if (!voucherTag) {
    return new Response(null, { status: 200 });
  }

  const parts = voucherTag.split(":");
  // Expected format: voucher-ready:TIER:CODE
  if (parts.length !== 3) {
    console.warn(`[customers/update] Malformed voucher tag: ${voucherTag}`);
    return new Response(null, { status: 200 });
  }

  const [, tier, code] = parts;
  const templateName = TIER_TO_TEMPLATE[tier];

  if (!templateName) {
    console.warn(`[customers/update] Unknown tier in voucher tag: ${tier}`);
    return new Response(null, { status: 200 });
  }

  const phone = customer.phone ?? "";
  const name = customer.first_name ?? "Customer";

  // Send WhatsApp notification
  await sendWhatsappTemplate(phone, templateName, [name, code]);
  console.log(`[customers/update] Sent ${templateName} to ${phone} (tier=${tier}, code=${code})`);

  // Remove the voucher-ready tag so this doesn't fire again on next update
  const customerId = `gid://shopify/Customer/${customer.id}`;
  const remainingTags = tags.filter((t) => t !== voucherTag);

  try {
    const { admin } = await (await import("../shopify.server")).unauthenticated.admin(shop);

    const response = await admin.graphql(
      `#graphql
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id tags }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: customerId, tags: remainingTags } } }
    );

    const data = await response.json();
    const errors = data?.data?.customerUpdate?.userErrors || [];
    if (errors.length > 0) {
      console.error("[customers/update] Failed to remove voucher tag:", errors);
    } else {
      console.log(`[customers/update] Removed tag "${voucherTag}" from customer ${customerId}`);
    }
  } catch (err) {
    console.error("[customers/update] Error removing voucher tag:", err);
  }

  return new Response(null, { status: 200 });
};
