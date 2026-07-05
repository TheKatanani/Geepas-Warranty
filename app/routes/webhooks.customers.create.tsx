import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  upsertZohoCustomer,
  resolveCustomerName,
  type ZohoAddress,
} from "../services/zoho.server";

/**
 * CUSTOMERS_CREATE webhook
 *
 * Fires when a new Shopify customer is created — including via the OTP /
 * new-customer-accounts flow, which often arrives with email=null and
 * first_name/last_name=null. The customer_name fallback chain handles this.
 *
 * Webhook HMAC verification: handled by authenticate.webhook() automatically.
 *
 * Register:
 *   Topic:   customers/create
 *   Address: https://your-app.vercel.app/webhooks/customers/create
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const c = payload as ShopifyCustomerPayload;

  // --- Derive missing first/last from default_address.name when possible ---
  const addrName = c.default_address?.name?.trim() ?? "";
  const nameParts = addrName ? addrName.split(/\s+/) : [];
  const derivedFirst = c.first_name?.trim() || (nameParts[0] ?? "");
  const derivedLast = c.last_name?.trim() || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

  // --- Resolve customer_name using the full fallback chain ---
  const { name: customerName, resolvedBy } = resolveCustomerName({
    firstName: derivedFirst,
    lastName: derivedLast,
    email: c.email,
    phone: c.phone,
    shopifyCustomerId: c.id,
  });

  console.log(
    `[${topic}] shop=${shop} customer id=${c.id} ` +
      `name="${customerName}" (resolved by: ${resolvedBy}) ` +
      `email=${c.email ?? "—"} phone=${c.phone ?? "—"}`,
  );

  // --- Map Shopify address → Zoho billing address ---
  const addr = c.default_address;
  const billingAddress: ZohoAddress | undefined = addr
    ? {
        attention: customerName,
        address: addr.address1 ?? undefined,
        street2: addr.address2 ?? undefined,
        city: addr.city ?? undefined,
        state: addr.province ?? undefined,
        zip: addr.zip ?? undefined,
        country: addr.country ?? undefined,
        phone: addr.phone ?? c.phone ?? undefined,
      }
    : undefined;

  // --- Retry up to 3× with exponential back-off ---
  const MAX_ATTEMPTS = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${topic}] Zoho upsert attempt ${attempt}/${MAX_ATTEMPTS} for customer ${c.id}`);

    const result = await upsertZohoCustomer({
      customer_name: customerName,
      first_name: derivedFirst || undefined,
      last_name: derivedLast || undefined,
      // Only set email/phone when they exist — never send empty strings
      ...(c.email ? { email: c.email } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
      billing_address: billingAddress,
      shipping_address: billingAddress,
      shopify_customer_id: String(c.id),
      notes: `Shopify ID: ${c.id} | Shop: ${shop}`,
    });

    if (result.success) {
      console.log(
        `[${topic}] ✓ Zoho ${result.alreadyExists ? "updated" : "created"} ` +
          `contact ${result.zohoContactId} ` +
          `(matched by: ${result.matchedBy ?? "none"}) ` +
          `for Shopify customer ${c.id}`,
      );
      return new Response(null, { status: 200 });
    }

    lastError = result.error ?? "unknown";
    console.warn(`[${topic}] Attempt ${attempt} failed: ${lastError}`);

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }

  // Return 200 even on total failure — non-200 causes Shopify to retry
  // indefinitely, which would hammer Zoho during an outage.
  // Recovery: Shopify Admin → Settings → Notifications → Webhooks → re-send.
  console.error(
    `[${topic}] All ${MAX_ATTEMPTS} attempts failed for customer ${c.id}: ${lastError}`,
  );
  return new Response(null, { status: 200 });
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopifyAddress {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  /** Shopify often includes the full name on the default address */
  name?: string | null;
}

interface ShopifyCustomerPayload {
  id: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  default_address?: ShopifyAddress | null;
}
