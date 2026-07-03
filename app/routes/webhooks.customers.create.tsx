import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { upsertZohoCustomer, type ZohoAddress } from "../services/zoho.server";

/**
 * CUSTOMERS_CREATE webhook
 *
 * Fires when a new customer is created in Shopify (including via the warranty
 * registration form). Syncs the customer to Zoho Inventory as a contact with
 * customer_source = "Shopify".
 *
 * Shopify webhook signature verification is handled automatically by
 * authenticate.webhook() — no manual HMAC check needed.
 *
 * Register this webhook:
 *   Topic:   customers/create
 *   Address: https://your-app.vercel.app/webhooks/customers/create
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[${topic}] received for shop=${shop}`);

  const customer = payload as ShopifyCustomerPayload;
  console.log(`[${topic}] customer id=${customer.id} email=${customer.email}`);

  // Build display name — fall back gracefully if names are missing
  const firstName = customer.first_name?.trim() ?? "";
  const lastName = customer.last_name?.trim() ?? "";
  const customerName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    customer.email ||
    `Customer ${customer.id}`;

  // Map Shopify default_address → Zoho billing address
  const addr = customer.default_address;
  const billingAddress: ZohoAddress | undefined = addr
    ? {
        attention: customerName,
        address: addr.address1 ?? undefined,
        street2: addr.address2 ?? undefined,
        city: addr.city ?? undefined,
        state: addr.province ?? undefined,
        zip: addr.zip ?? undefined,
        country: addr.country ?? undefined,
        phone: addr.phone ?? customer.phone ?? undefined,
      }
    : undefined;

  // Retry up to 3 times with exponential back-off (1 s, 2 s)
  const MAX_ATTEMPTS = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${topic}] Zoho upsert attempt ${attempt}/${MAX_ATTEMPTS}`);

    const result = await upsertZohoCustomer({
      customer_name: customerName,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      customer_source: "Shopify",
      customer_type: "individual",
      billing_address: billingAddress,
      shipping_address: billingAddress,
      notes: `Shopify ID: ${customer.id} | Shop: ${shop}`,
    });

    if (result.success) {
      console.log(
        `[${topic}] ✓ Zoho ${result.alreadyExists ? "updated" : "created"} ` +
          `contact ${result.zohoContactId} for Shopify customer ${customer.id}`,
      );
      return new Response(null, { status: 200 });
    }

    lastError = result.error ?? "unknown";
    console.warn(`[${topic}] Attempt ${attempt} failed: ${lastError}`);

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }

  // All attempts failed. Return 200 so Shopify does not flood us with retries.
  // Check Vercel logs and re-trigger manually from Shopify admin if needed.
  console.error(
    `[${topic}] All ${MAX_ATTEMPTS} attempts failed for customer ${customer.id}: ${lastError}`,
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
