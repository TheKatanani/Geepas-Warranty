import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { sendWarrantySms } from "../services/infobip.server";

/**
 * POST /api/send-warranty-sms
 *
 * Sends a warranty confirmation SMS via Infobip and logs the result to SMSLog.
 *
 * Expected JSON body:
 * {
 *   shop: string
 *   phone: string
 *   customerName: string
 *   voucherCode: string | null
 *   productName: string
 *   warrantyDays: number
 *   registrationId: string
 *   registrationDate: string   // ISO-8601
 *   voucherExpiryDays?: number // default 30
 *   lang?: "ar" | "en"        // default "ar"
 * }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    shop,
    phone,
    customerName,
    voucherCode = null,
    productName,
    warrantyDays,
    registrationId,
    registrationDate,
    voucherExpiryDays = 30,
    lang = "ar",
  } = body;

  // --- Validate required fields ---
  const missing = (["shop", "phone", "customerName", "productName", "warrantyDays", "registrationId", "registrationDate"] as const)
    .filter((k) => !body[k]);

  if (missing.length > 0) {
    return json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
  }

  // --- Send SMS ---
  const result = await sendWarrantySms({
    phoneNumber: phone,
    customerName,
    voucherCode: voucherCode ?? null,
    productName,
    warrantyDays: Number(warrantyDays),
    registrationId,
    registrationDate: new Date(registrationDate),
    voucherExpiryDays: Number(voucherExpiryDays),
    lang,
  });

  // --- Persist to SMSLog ---
  try {
    await prisma.sMSLog.create({
      data: {
        shop,
        phone: result.phone,
        registrationId: registrationId ?? null,
        smsSent: result.success,
        smsSentAt: result.success ? new Date(result.timestamp) : null,
        smsProviderResponse: result.rawResponse
          ?? result.error
          ?? (result.success ? result.messageId : null)
          ?? null,
      },
    });
  } catch (dbErr) {
    // Non-fatal — don't fail the response if only the log write failed
    console.error("[api.send-warranty-sms] Failed to write SMSLog:", dbErr);
  }

  if (result.success) {
    return json({
      success: true,
      messageId: result.messageId,
      phone: result.phone,
      timestamp: result.timestamp,
    });
  }

  return json(
    {
      success: false,
      phone: result.phone,
      timestamp: result.timestamp,
      error: result.error,
    },
    { status: 502 },
  );
};
