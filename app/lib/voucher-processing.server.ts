import { sendWhatsappTemplate } from "./whatsapp.server";

const TIER_TO_TEMPLATE: Record<string, string> = {
  WELCOME10: "welcome_voucher",
  WARRANTY15: "warranty_voucher",
  NEXT15: "next_purchase_voucher",
  SECOND15: "second_purchase_voucher",
};

export interface VoucherCustomer {
  id: string;          // Shopify GID e.g. "gid://shopify/Customer/123"
  firstName: string;
  phone: string;
  tags: string[];      // already-parsed tag array
}

export interface VoucherResult {
  customerId: string;
  status: "sent" | "skipped" | "error";
  reason?: string;
}

/**
 * Process a single customer: find a voucher-ready tag, send the WhatsApp
 * template, then remove the tag so it isn't acted on again.
 *
 * Returns a result object describing what happened.
 */
export async function processCustomerVoucher(
  admin: any,
  customer: VoucherCustomer,
  context: string = "voucher-processing",
): Promise<VoucherResult> {
  const voucherTag = customer.tags.find((t) => t.startsWith("voucher-ready:"));

  if (!voucherTag) {
    return { customerId: customer.id, status: "skipped", reason: "no voucher-ready tag" };
  }

  const parts = voucherTag.split(":");
  if (parts.length !== 3) {
    console.warn(`[${context}] Malformed voucher tag: ${voucherTag}`);
    return { customerId: customer.id, status: "skipped", reason: `malformed tag: ${voucherTag}` };
  }

  const [, tier, code] = parts;
  const templateName = TIER_TO_TEMPLATE[tier];

  if (!templateName) {
    console.warn(`[${context}] Unknown tier "${tier}" in tag: ${voucherTag}`);
    return { customerId: customer.id, status: "skipped", reason: `unknown tier: ${tier}` };
  }

  const name = customer.firstName || "Customer";
  const phone = customer.phone || "";

  try {
    await sendWhatsappTemplate(phone, templateName, [name, code]);
    console.log(`[${context}] Sent ${templateName} to ${phone} (tier=${tier}, code=${code})`);
  } catch (err) {
    console.error(`[${context}] sendWhatsappTemplate failed for ${customer.id}:`, err);
    return { customerId: customer.id, status: "error", reason: "whatsapp send failed" };
  }

  // Remove the voucher-ready tag so it isn't processed again
  const remainingTags = customer.tags.filter((t) => t !== voucherTag);

  try {
    const response = await admin.graphql(
      `#graphql
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id tags }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: customer.id, tags: remainingTags } } },
    );

    const data = await response.json();
    const errors = data?.data?.customerUpdate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[${context}] Failed to remove voucher tag from ${customer.id}:`, errors);
    } else {
      console.log(`[${context}] Removed tag "${voucherTag}" from ${customer.id}`);
    }
  } catch (err) {
    console.error(`[${context}] Error removing voucher tag from ${customer.id}:`, err);
  }

  return { customerId: customer.id, status: "sent" };
}
