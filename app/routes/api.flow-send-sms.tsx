import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { sendWarrantySms } from "../services/infobip.server";
import { normalizePhone } from "../utils/twilio.server";

/**
 * POST /api/flow-send-sms
 *
 * Called directly by Shopify Flow via an HTTP action.
 * Replaces the customers/update webhook approach — Flow does NOT fire
 * customers/update for tag changes it makes itself, so Flow must call us directly.
 *
 * Expected JSON body:
 * {
 *   phone:        "{{ customer.phone }}",
 *   customerName: "{{ customer.firstName }}",
 *   discountCode: "WARRANTY15-{{ customer.legacyResourceId }}",
 *   rewardType:   "WARRANTY15",
 *   shop:         "ae53cd-2.myshopify.com",
 *   customerId:   "{{ customer.legacyResourceId }}"  // optional but recommended
 * }
 *
 * Security: requires X-Flow-Secret header === FLOW_SHARED_SECRET env var.
 * Returns 500 on SMS failure so Flow marks the run as failed and allows retry
 * from the Flow run page.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const LOG = "[flow-send-sms]";

  // --- 1. Method guard ---
  if (request.method !== "POST") {
    console.warn(`${LOG} 405 — method=${request.method}`);
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // --- 2. Shared-secret authentication ---
  const expectedSecret = process.env.FLOW_SHARED_SECRET ?? "";
  const receivedSecret = request.headers.get("X-Flow-Secret") ?? "";

  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn(
      `${LOG} 401 — secret mismatch (header present: ${Boolean(receivedSecret)}, env configured: ${Boolean(expectedSecret)})`,
    );
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- 3. Parse body ---
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    console.warn(`${LOG} 400 — invalid JSON body`);
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { phone, customerName, discountCode, rewardType, shop, customerId } = body as {
    phone?: string;
    customerName?: string;
    discountCode?: string;
    rewardType?: string;
    shop?: string;
    customerId?: string;
  };

  // --- 4. Required-field validation ---
  const missing = (["phone", "discountCode", "rewardType"] as const).filter(
    (k) => !body[k],
  );
  if (missing.length > 0) {
    console.warn(`${LOG} 400 — missing fields: ${missing.join(", ")}`);
    return json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
  }

  const shopDomain = (shop as string) ?? "unknown";
  console.log(
    `${LOG} received — shop=${shopDomain} phone=${phone} code=${discountCode} rewardType=${rewardType}`,
  );

  // --- 5. Normalize phone ---
  const normalizedPhone = normalizePhone(phone!);
  console.log(`${LOG} normalized phone: ${phone} → ${normalizedPhone}`);

  // --- 6. Look up warranty registration for SMS content (non-fatal if missing) ---
  let productName = "Geepas product";
  let registrationId: string | undefined;
  let registrationDate: Date = new Date();

  try {
    const registration = await prisma.warrantyRegistration.findFirst({
      where: { phone: normalizedPhone },
      orderBy: { createdAt: "desc" },
      include: { products: true },
    });

    if (registration) {
      productName = registration.products?.[0]?.productTitle ?? "Geepas product";
      registrationId = registration.id;
      registrationDate = registration.createdAt;
      console.log(`${LOG} found registration id=${registration.id} product="${productName}"`);
    } else {
      console.warn(
        `${LOG} no warranty registration found for ${normalizedPhone} — using fallbacks`,
      );
    }
  } catch (lookupErr) {
    console.error(`${LOG} registration lookup failed (non-fatal):`, lookupErr);
  }

  // --- 7. Send SMS ---
  console.log(`${LOG} calling sendWarrantySms → ${normalizedPhone} code=${discountCode}`);

  const result = await sendWarrantySms({
    phoneNumber: normalizedPhone,
    customerName: (customerName as string) ?? "Customer",
    voucherCode: discountCode as string,
    productName,
    warrantyDays: 365,
    registrationId: registrationId ?? `flow-${Date.now()}`,
    registrationDate,
    voucherExpiryDays: 30,
    lang: "ar",
    shop: shopDomain,
  });

  // --- 8. Persist SMSLog (skip on dedup — already logged) ---
  if (!result.isDuplicate) {
    try {
      await prisma.sMSLog.create({
        data: {
          shop: shopDomain,
          phone: normalizedPhone,
          registrationId: registrationId ?? null,
          smsSent: result.success,
          smsSentAt: result.success ? new Date(result.timestamp) : null,
          smsProviderResponse: result.rawResponse ?? result.error ?? null,
        },
      });
    } catch (logErr) {
      console.error(`${LOG} SMSLog write failed (non-fatal):`, logErr);
    }
  }

  // --- 9. On failure: return 500 so Flow marks the run as failed and retries ---
  if (!result.success && !result.isDuplicate) {
    console.error(`${LOG} SMS failed for ${normalizedPhone}:`, result.error);
    return json({ success: false, error: result.error }, { status: 500 });
  }

  if (result.isDuplicate) {
    console.warn(`${LOG} dedup fired — SMS already sent to ${normalizedPhone} recently`);
  } else {
    console.log(`${LOG} SMS sent — messageId=${result.messageId}`);
  }

  // --- 10. Upsert CustomerReward on genuine success (not dedup — record already exists) ---
  if (!result.isDuplicate) {
    // Derive Shopify customer GID: prefer explicit customerId field,
    // fall back to extracting the legacy ID appended to the discount code.
    let customerGid: string;
    if (customerId) {
      customerGid = `gid://shopify/Customer/${customerId}`;
    } else {
      // discountCode format: "WARRANTY15-<legacyId>"
      const legacyId = (discountCode as string).split("-").at(-1);
      customerGid = legacyId
        ? `gid://shopify/Customer/${legacyId}`
        : `gid://shopify/Customer/unknown`;
    }

    try {
      await prisma.customerReward.upsert({
        where: {
          shop_phone_rewardType: {
            shop: shopDomain,
            phone: normalizedPhone,
            rewardType: rewardType as string,
          },
        },
        update: {
          discountCode: discountCode as string,
          sentAt: new Date(),
        },
        create: {
          shop: shopDomain,
          phone: normalizedPhone,
          customerId: customerGid,
          rewardType: rewardType as string,
          discountCode: discountCode as string,
          sentAt: new Date(),
        },
      });
      console.log(
        `${LOG} CustomerReward upserted — phone=${normalizedPhone} rewardType=${rewardType}`,
      );
    } catch (rewardErr) {
      // Non-fatal — customer already received their SMS and code.
      console.error(`${LOG} CustomerReward upsert failed (non-fatal):`, rewardErr);
    }
  }

  return json({ success: true, messageId: result.messageId ?? null });
};
