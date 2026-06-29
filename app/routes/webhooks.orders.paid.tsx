import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
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
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[orders/paid] ${topic} received for shop=${shop}`);

  const order = payload as {
    id: number;
    order_number?: number;
    subtotal_price?: string;
    currency?: string;
    created_at?: string;
    customer?: {
      id: number;
      first_name?: string;
      phone?: string;
      orders_count?: number;
    };
    line_items?: Array<{ title?: string }>;
  };

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

  const rawPhone = customer.phone ?? "";
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

  // ---- Voucher 1: subtotal >= 100,000 IQD → NEXT15 (15% off next order) --------

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

  // ---- Voucher 3: first paid order (orders_count === 1) → SECOND15 --------------
  // orders_count on the customer snapshot inside the orders/paid payload reflects
  // the count at the moment of order payment, including the current order.
  // orders_count === 1 therefore means this IS the customer's first paid order.

  if (ordersCount === 1) {
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
    console.log(
      `[voucher3] ordersCount=${ordersCount} — not first order, skipping SECOND15`,
    );
  }

  // Always return 200 immediately — reward work runs in the background.
  return new Response(null, { status: 200 });
};
