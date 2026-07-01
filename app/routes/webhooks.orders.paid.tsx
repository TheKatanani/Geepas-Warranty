import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { normalizePhone } from "../utils/twilio.server";
import { issueRewardAndNotify } from "../services/reward.server";

/**
 * ORDERS_PAID webhook — fires when payment is captured on an order.
 *
 * Voucher 1 [voucher1]: order subtotal >= 100,000 IQD → 15% discount, valid 60 days.
 * Voucher 3 [voucher3]: customer's first-ever paid order → 15% next-order discount.
 *
 * Both can fire on the same order. Each path is independently wrapped so a failure
 * in one never prevents the other from running.
 *
 * Payload field notes (Shopify REST webhook format):
 *   subtotal_price       — string, order subtotal after discounts in shop currency (IQD).
 *                          Does NOT include shipping or taxes.
 *   currency             — string, always "IQD" for this store.
 *   customer.orders_count — integer, total number of orders for this customer INCLUDING
 *                          the current one. Value of 1 means this is the first paid order.
 */

type OrderPayload = {
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
function resolveOrderPhone(order: OrderPayload): string {
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
async function saveCustomerPhone(
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[orders/paid] ${topic} received for shop=${shop}`);

  const order = payload as OrderPayload;

  // --- Extract order fields ---
  const subtotal = parseFloat(order.subtotal_price ?? "0");
  const currency = order.currency ?? "IQD";
  const orderId = order.id;
  const orderNumber = order.order_number ?? orderId;
  const orderDate = order.created_at ? new Date(order.created_at) : new Date();
  const productName = order.line_items?.[0]?.title ?? "Geepas product";

  // --- Extract customer fields ---
  const customer = order.customer;
  if (!customer) {
    console.log(`[orders/paid] order ${orderNumber} has no customer — skipping`);
    return new Response(null, { status: 200 });
  }

  // Resolve phone: customer record first, then order-level and address fields.
  // customer.phone is null on first orders because Shopify only saves it after checkout.
  const rawPhone = resolveOrderPhone(order);
  const customerName = customer.first_name ?? "Customer";
  const customerId = `gid://shopify/Customer/${customer.id}`;
  const ordersCount = customer.orders_count ?? 0;

  console.log(
    `[orders/paid] order=${orderNumber} subtotal=${subtotal} ${currency} ` +
    `customer=${customer.id} ordersCount=${ordersCount} phone=${rawPhone || "(none)"}`,
  );

  // --- Guard: no phone means we cannot send any SMS ---
  if (!rawPhone) {
    console.log(`[orders/paid] customer ${customer.id} has no phone — skipping all vouchers`);
    return new Response(null, { status: 200 });
  }

  const normalizedPhone = normalizePhone(rawPhone);

  // --- Backfill phone on customer record if it was missing ---
  // Applies on first orders where Shopify leaves customer.phone null but the
  // delivery phone is present on the order/address.
  if (!customer.phone) {
    await saveCustomerPhone(shop, customerId, normalizedPhone);
  }

  // ---- Voucher logic: first order vs. repeat order (mutually exclusive) ---------
  // ordersCount is the customer's order count BEFORE the current order.
  // ordersCount === 0 means this IS the customer's first paid order.

  const isFirstOrder = (ordersCount ?? 0) === 0;

  if (isFirstOrder) {
    // ---- Voucher 3: first paid order → SECOND15 (15% off second order) ----------
    console.log(
      `[voucher3] first order for customer ${customer.id} — issuing SECOND15`,
    );
    issueRewardAndNotify({
      shop,
      customerId,
      phone: normalizedPhone,
      customerName,
      productName,
      registrationId: `order-${orderId}-second15`,
      registrationDate: orderDate,
      rewardType: "SECOND15",
      discountPercentage: 15,
      expiryDays: 60,
    }).then((result) => {
      if (result.success) {
        console.log(
          `[voucher3] reward issued — code=${result.discountCode} messageId=${result.messageId}`,
        );
      } else {
        console.error(
          `[voucher3] issueRewardAndNotify failed for order ${orderNumber}:`,
          result.error,
        );
      }
    }).catch((err) => {
      console.error(`[voucher3] issueRewardAndNotify threw for order ${orderNumber}:`, err);
    });
  } else {
    // ---- Voucher 1: repeat order, subtotal >= 100,000 IQD → NEXT15 --------------
    if (subtotal >= 100000) {
      console.log(
        `[voucher1] subtotal ${subtotal} ${currency} >= 100000 — issuing NEXT15 for customer ${customer.id}`,
      );
      issueRewardAndNotify({
        shop,
        customerId,
        phone: normalizedPhone,
        customerName,
        productName,
        registrationId: `order-${orderId}-next15`,
        registrationDate: orderDate,
        rewardType: "NEXT15",
        discountPercentage: 15,
        expiryDays: 60,
      }).then((result) => {
        if (result.success) {
          console.log(
            `[voucher1] reward issued — code=${result.discountCode} messageId=${result.messageId}`,
          );
        } else {
          console.error(
            `[voucher1] issueRewardAndNotify failed for order ${orderNumber}:`,
            result.error,
          );
        }
      }).catch((err) => {
        console.error(`[voucher1] issueRewardAndNotify threw for order ${orderNumber}:`, err);
      });
    } else {
      console.log(
        `[voucher1] subtotal ${subtotal} ${currency} < 100000 — skipping NEXT15`,
      );
    }
  }

  // Always return 200 immediately — reward work runs in the background.
  return new Response(null, { status: 200 });
};
