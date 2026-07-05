import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  upsertZohoCustomer,
  resolveCustomerName,
  type ZohoAddress,
} from "../services/zoho.server";
import { fetchCustomerFromAdmin } from "../lib/fetch-customer.server";

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

  // --- RAW payload diagnostic (runs before any transformation) ---
  console.log(
    `[${topic}] RAW payload keys: ${Object.keys(c as object).join(", ")}`,
  );
  console.log(
    `[${topic}] RAW first_name=${JSON.stringify(c.first_name)} ` +
      `last_name=${JSON.stringify(c.last_name)} ` +
      `email=${JSON.stringify(c.email)}`,
  );

  // --- Fetch the full customer record via Admin GraphQL ---
  // The webhook payload is GDPR-redacted (only id, first_name, phone — no
  // email, no last_name), so we use the payload solely as a trigger and
  // pull the authoritative fields from the Admin API using the existing
  // offline session/admin client.
  let firstName = c.first_name;
  let lastName = c.last_name;
  let email = c.email;
  let phone = c.phone;
  let addressName: string | undefined;

  try {
    const customer = await fetchCustomerFromAdmin(shop, c.id);
    firstName = customer.firstName ?? undefined;
    lastName = customer.lastName ?? undefined;
    email = customer.email ?? undefined;
    phone = customer.phone ?? undefined;
    addressName = customer.defaultAddressName ?? undefined;
    console.log(
      `[${topic}] Admin GraphQL fetch ✓ customer ${c.id}: ` +
        `firstName=${firstName ?? "—"} lastName=${lastName ?? "—"} ` +
        `email=${email ?? "—"} phone=${phone ?? "—"}`,
    );
  } catch (err: any) {
    console.warn(
      `[${topic}] Admin GraphQL fetch failed for customer ${c.id} — ` +
        `falling back to webhook payload fields: ${err?.message ?? err}`,
    );
  }

  // --- Resolve customer_name using the full fallback chain ---
  const { name: customerName, resolvedBy } = resolveCustomerName({
    firstName,
    lastName,
    email,
    phone,
    shopifyCustomerId: c.id,
  });

  console.log(
    `[${topic}] shop=${shop} customer id=${c.id} ` +
      `name="${customerName}" (resolved by: ${resolvedBy}) ` +
      `email=${email ?? "—"} phone=${phone ?? "—"}`,
  );

  // --- Map Shopify address → Zoho billing address ---
  // Only the address `name` field is available from the Admin GraphQL query;
  // fall back to the webhook payload's default_address when GraphQL failed.
  const addr = c.default_address;
  const billingAddress: ZohoAddress | undefined = addressName || addr
    ? {
        attention: addressName ?? customerName,
        address: addr?.address1 ?? undefined,
        street2: addr?.address2 ?? undefined,
        city: addr?.city ?? undefined,
        state: addr?.province ?? undefined,
        zip: addr?.zip ?? undefined,
        country: addr?.country ?? undefined,
        phone: addr?.phone ?? phone ?? undefined,
      }
    : undefined;

  // --- Retry up to 3× with exponential back-off ---
  const MAX_ATTEMPTS = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${topic}] Zoho upsert attempt ${attempt}/${MAX_ATTEMPTS} for customer ${c.id}`);

    const result = await upsertZohoCustomer({
      customer_name: customerName,
      // Pass name parts so buildCreateBody can populate contact_persons correctly
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      // Only set email/phone when they exist — never send empty strings
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
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
}

interface ShopifyCustomerPayload {
  id: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  default_address?: ShopifyAddress | null;
}
