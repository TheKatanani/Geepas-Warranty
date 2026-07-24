import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { normalizePhone } from "../utils/phone.server";
import { sendWhatsAppTemplate } from "../services/infobip.server";
import prisma from "../db.server";

interface GiftCardPayload {
  id: number;
  code?: string;
  masked_code?: string;
  last_characters?: string;
  initial_value?: string;
  balance?: string;
  currency?: string;
  customer_id?: number | null;
  order_id?: number | null;
  note?: string | null;
}

/**
 * GIFT_CARDS_CREATE webhook — fires when a gift card is created/issued.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[${topic}] webhook received for shop=${shop}`);

  const card = payload as GiftCardPayload;

  // --- Extract fields ---
  const giftCardId = card.id;
  const initialValue = parseFloat(card.initial_value ?? "0");
  const currency = card.currency ?? "IQD";
  const maskedCode = card.masked_code ?? card.code ?? `•••• •••• •••• ${card.last_characters ?? ""}`;
  const amountFormatted = `${initialValue.toLocaleString()} ${currency}`;

  let recipientPhone = "";
  let recipientName = "Customer";

  // --- Resolve Customer ---
  // Try retrieving customer directly if customer_id exists
  if (card.customer_id) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const customerQuery = `#graphql
        query getCustomer($id: ID!) {
          customer(id: $id) {
            firstName
            phone
          }
        }
      `;
      const response = await admin.graphql(customerQuery, {
        variables: { id: `gid://shopify/Customer/${card.customer_id}` },
      });
      const data = (await response.json()) as any;
      const customer = data?.data?.customer;
      if (customer) {
        recipientName = customer.firstName ?? "Customer";
        recipientPhone = customer.phone ?? "";
        console.log(`[${topic}] Resolved customer details from customer_id: name=${recipientName}, phone=${recipientPhone}`);
      }
    } catch (err) {
      console.error(`[${topic}] Failed to query customer by customer_id:`, err);
    }
  }

  // If no customer phone, try pulling from the order if order_id exists
  if (!recipientPhone && card.order_id) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const orderQuery = `#graphql
        query getOrder($id: ID!) {
          order(id: $id) {
            customer {
              firstName
              phone
            }
            shippingAddress {
              phone
            }
            billingAddress {
              phone
            }
          }
        }
      `;
      const response = await admin.graphql(orderQuery, {
        variables: { id: `gid://shopify/Order/${card.order_id}` },
      });
      const data = (await response.json()) as any;
      const order = data?.data?.order;
      if (order) {
        recipientName = order.customer?.firstName ?? recipientName;
        recipientPhone = order.customer?.phone ?? order.shippingAddress?.phone ?? order.billingAddress?.phone ?? "";
        console.log(`[${topic}] Resolved customer details from order_id: name=${recipientName}, phone=${recipientPhone}`);
      }
    } catch (err) {
      console.error(`[${topic}] Failed to query order details:`, err);
    }
  }

  if (!recipientPhone) {
    console.warn(`[${topic}] No phone number resolved for Gift Card ${giftCardId} — skipping WhatsApp send`);
    return new Response(null, { status: 200 });
  }

  const normalizedPhone = normalizePhone(recipientPhone);
  if (!normalizedPhone) {
    console.warn(`[${topic}] Phone number "${recipientPhone}" failed E.164 normalization — skipping WhatsApp send`);
    return new Response(null, { status: 200 });
  }

  // --- Send WhatsApp message ---
  const templateName = "gift_card_notification";
  const placeholders = [
    recipientName,    // {{1}}
    amountFormatted,  // {{2}}
    maskedCode,       // {{3}}
    recipientName,    // {{4}}
    amountFormatted,  // {{5}}
    maskedCode,       // {{6}}
  ];

  console.log(`[${topic}] Sending Gift Card WhatsApp to ${normalizedPhone} code=${maskedCode}`);
  const result = await sendWhatsAppTemplate({
    phoneNumber: normalizedPhone,
    templateName,
    placeholders,
    shop,
    registrationId: `giftcard-${giftCardId}`,
  });

  // --- Log to SMSLog ---
  try {
    await prisma.sMSLog.create({
      data: {
        shop,
        phone: normalizedPhone,
        registrationId: null,
        smsSent: result.success,
        smsSentAt: result.success ? new Date(result.timestamp) : null,
        smsProviderResponse: result.rawResponse ?? result.error ?? null,
      },
    });
  } catch (dbErr) {
    console.error(`[${topic}] Failed to write SMSLog for gift card notification:`, dbErr);
  }

  return new Response(null, { status: 200 });
};
