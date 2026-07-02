/**
 * Server-only helpers for the webhooks.orders.paid route.
 *
 * Keeping these in a `.server.ts` file guarantees Vite/Remix never
 * tries to include them in the client bundle, eliminating the
 * "Server-only module referenced by client" build error that occurs
 * when named exports that depend on shopify.server are placed directly
 * in the route module.
 */

import { unauthenticated } from "../shopify.server";

export type OrderPayload = {
  id: number;
  order_number?: number;
  subtotal_price?: string;
  currency?: string;
  created_at?: string;
  phone?: string;
  shipping_address?: { phone?: string };
  billing_address?: { phone?: string };
  customer?: {
    id: number;
    first_name?: string;
    phone?: string;
    orders_count?: number;
  };
  line_items?: Array<{ title?: string }>;
};

/** Returns the first non-empty phone found across order-level and address fields. */
export function resolveOrderPhone(order: OrderPayload): string {
  return (
    order.customer?.phone ||
    order.phone ||
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    ""
  );
}

/**
 * Writes a normalized phone number to the Shopify customer record.
 * Best-effort and non-fatal — phone uniqueness violations are logged and skipped.
 * Note: this customerUpdate fires a customers/update webhook, but that handler is
 * gated on voucher-ready: tags and safely no-ops here.
 */
export async function saveCustomerPhone(
  shop: string,
  customerId: string,
  normalizedPhone: string,
): Promise<void> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: customerId, phone: normalizedPhone } } },
    );
    const data = await response.json();
    const userErrors: Array<{ field: string; message: string }> =
      data?.data?.customerUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      const messages = userErrors.map((e) => e.message).join("; ");
      console.warn(`[orders/paid] saveCustomerPhone skipped: ${messages}`);
      return;
    }
    console.log(
      `[orders/paid] saveCustomerPhone: saved phone ${normalizedPhone} to customer ${customerId}`,
    );
  } catch (err) {
    console.error(`[orders/paid] saveCustomerPhone threw (non-fatal):`, err);
  }
}
