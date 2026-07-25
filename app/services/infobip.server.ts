/**
 * Infobip WhatsApp Service
 * Sends bilingual warranty confirmations, vouchers, and gift card notifications
 * via the Infobip WhatsApp REST API.
 * Credentials are read dynamically from environment variables.
 */

import prisma from "../db.server";
import { normalizePhone } from "../utils/phone.server";

// Dynamic helper to fetch env variables at execution time (resilient in tests & serverless)
function getEnv() {
  return {
    apiKey: process.env.INFOBIP_API_KEY ?? "",
    baseUrl: (process.env.INFOBIP_BASE_URL ?? "").replace(/\/$/, ""),
    whatsappSender: process.env.INFOBIP_WHATSAPP_SENDER ?? "",
    whatsappLang: process.env.INFOBIP_WHATSAPP_LANG ?? "ar",
  };
}

// Deduplication window — checked against SMSLog in DB, not in-memory.
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// ---- Types ----------------------------------------------------------------

export interface InfobipSmsParams {
  phoneNumber: string;       // raw input — will be normalised to E.164
  customerName: string;
  voucherCode: string | null;
  productName: string;
  warrantyDays: number;
  registrationId: string;
  registrationDate: Date;
  voucherExpiryDays?: number; // defaults to 30
  lang?: "ar" | "en";        // kept for compatibility
  shop?: string;             // required for DB dedup check
  rewardType?: string;       // "SECOND15" | "NEXT15" | "WARRANTY..."
  discountPercentage?: number; // optional, will be parsed from rewardType if missing
}

export interface InfobipSmsResult {
  success: boolean;
  messageId?: string;
  phone: string;             // normalised E.164
  timestamp: string;         // ISO-8601
  error?: string;
  rawResponse?: string;
}

export interface WhatsAppTemplateParams {
  phoneNumber: string;
  templateName: string;
  placeholders: string[];
  language?: string;
  shop?: string;
  registrationId?: string;
  dedupeKey?: string;
}

// ---- Helper function to extract discount percentage ----
function extractDiscountPercentage(rewardType?: string, passedPct?: number): number {
  if (passedPct !== undefined && passedPct !== null) return passedPct;
  if (!rewardType) return 15; // default fallback
  const match = rewardType.match(/\d+/);
  return match ? parseInt(match[0], 10) : 15;
}

// ---- Core send function ---------------------------------------------------

async function sendWhatsAppOnce(
  phone: string,
  templateName: string,
  placeholders: string[],
  language: string
): Promise<{ success: boolean; messageId?: string; error?: string; rawResponse?: string }> {
  const env = getEnv();

  if (!env.apiKey || !env.baseUrl) {
    return { success: false, error: "Infobip credentials not configured (check env vars)." };
  }
  if (!env.whatsappSender) {
    return { success: false, error: "INFOBIP_WHATSAPP_SENDER not configured." };
  }

  const url = `${env.baseUrl}/whatsapp/1/message/template`;

  const payload = {
    messages: [
      {
        from: env.whatsappSender,
        to: phone,
        content: {
          templateName,
          templateData: {
            body: {
              placeholders,
            },
          },
          language,
        },
      },
    ],
  };

  console.log(`[Infobip/sendWhatsAppOnce] POST ${url} → ${phone} using template ${templateName}`);

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("TIMEOUT")), 8000);
  });

  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `App ${env.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  fetchPromise.catch(() => {});

  let response: Response;
  try {
    response = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
  } catch (err: any) {
    clearTimeout(timeoutHandle!);
    return {
      success: false,
      error: err?.message === "TIMEOUT"
        ? "Infobip timed out after 8s"
        : `Network error: ${err?.message ?? String(err)}`,
    };
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (bodyErr: any) {
    return { success: false, error: `Failed to read Infobip response body: ${bodyErr?.message}` };
  }

  if (!response.ok) {
    console.error(`[Infobip/sendWhatsAppOnce] HTTP ${response.status} for ${phone} — body: ${raw}`);
    return {
      success: false,
      error: `Infobip HTTP ${response.status}`,
      rawResponse: raw,
    };
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { success: false, error: "Invalid JSON from Infobip", rawResponse: raw };
  }

  const msg = data?.messages?.[0];
  const status = msg?.status?.groupName;

  if (status === "ACCEPTED" || status === "PENDING" || status === "DELIVERED") {
    return { success: true, messageId: msg.messageId, rawResponse: raw };
  }

  const errDesc = msg?.status?.description ?? `Unexpected Infobip status: ${status}`;
  console.error(`[Infobip/sendWhatsAppOnce] Non-success status for ${phone} — ${errDesc} — body: ${raw}`);
  return {
    success: false,
    error: errDesc,
    rawResponse: raw,
  };
}

// ---- Public API -----------------------------------------------------------

/**
 * Sends a WhatsApp notification using a template.
 * Includes validation, normalization, and DB-backed deduplication.
 */
export async function sendWhatsAppTemplate(
  params: WhatsAppTemplateParams
): Promise<InfobipSmsResult & { isDuplicate?: boolean }> {
  const timestamp = new Date().toISOString();
  const phone = normalizePhone(params.phoneNumber);

  if (!phone) {
    const err = `Invalid phone number: "${params.phoneNumber}"`;
    console.error(`[Infobip/WhatsApp] ${err}`);
    return { success: false, phone: params.phoneNumber, timestamp, error: err };
  }

  if (!/^\+\d{7,15}$/.test(phone)) {
    const err = `Phone failed E.164 validation after normalisation: "${phone}"`;
    console.error(`[Infobip/WhatsApp] ${err}`);
    return { success: false, phone, timestamp, error: err };
  }

  // --- DB-backed deduplication ---
  // Using the stable dedupeKey or phone-based deduplication window.
  if (params.dedupeKey) {
    try {
      const existing = await prisma.sMSLog.findUnique({
        where: { dedupeKey: params.dedupeKey },
      });
      if (existing && existing.smsSent) {
        const msg = `Duplicate suppressed via dedupeKey: "${params.dedupeKey}"`;
        console.warn(`[Infobip/WhatsApp] ${msg}`);
        return { success: false, isDuplicate: true, phone, timestamp, error: msg };
      }
    } catch (dedupErr) {
      console.warn(`[Infobip/WhatsApp] DedupeKey DB check failed (proceeding):`, dedupErr);
    }
  } else {
    try {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
      const recent = await prisma.sMSLog.findFirst({
        where: {
          phone,
          smsSent: true,
          smsSentAt: { gte: cutoff },
        },
        orderBy: { smsSentAt: "desc" },
      });
      if (recent) {
        const agoSec = Math.round((Date.now() - recent.smsSentAt!.getTime()) / 1000);
        const waitSec = Math.ceil((DEDUP_WINDOW_MS - agoSec * 1000) / 1000);
        const msg = `Duplicate suppressed — already sent to ${phone} ${agoSec}s ago (${waitSec}s remaining in window)`;
        console.warn(`[Infobip/WhatsApp] ${msg}`);
        return { success: false, isDuplicate: true, phone, timestamp, error: msg };
      }
    } catch (dedupErr) {
      console.warn(`[Infobip/WhatsApp] Dedup DB check failed (proceeding):`, dedupErr);
    }
  }

  const env = getEnv();
  const language = params.language ?? env.whatsappLang;

  const result = await sendWhatsAppOnce(phone, params.templateName, params.placeholders, language);

  if (result.success) {
    console.log(`[Infobip/WhatsApp] ✓ Sent to ${phone}, messageId=${result.messageId}`);
    return {
      success: true,
      messageId: result.messageId,
      phone,
      timestamp,
      rawResponse: result.rawResponse,
    };
  }

  console.error(`[Infobip/WhatsApp] Send failed for ${phone}:`, result.error);
  return {
    success: false,
    phone,
    timestamp,
    error: result.error,
    rawResponse: result.rawResponse,
  };
}

/**
 * Backwards compatibility wrapper mapping the old sendWarrantySms parameters to the WhatsApp templates.
 */
export async function sendWarrantySms(
  params: InfobipSmsParams
): Promise<InfobipSmsResult & { isDuplicate?: boolean }> {
  const env = getEnv();
  // Determine if it is a discount voucher or a warranty confirmation
  const isVoucher =
    params.rewardType === "SECOND15" ||
    params.rewardType === "NEXT15" ||
    params.rewardType === "WELCOME10";

  let templateName = "warranty_registration";
  let placeholders: string[] = [];

  if (isVoucher) {
    const pct = String(extractDiscountPercentage(params.rewardType ?? undefined, params.discountPercentage));
    const expiry = String(params.voucherExpiryDays ?? 30);
    templateName = "voucher_code";
    // 8 parameters: Arabic (1-4) then English (5-8)
    placeholders = [
      params.customerName,   // {{1}}
      pct,                  // {{2}}
      params.voucherCode ?? "", // {{3}}
      expiry,               // {{4}}
      params.customerName,   // {{5}}
      pct,                  // {{6}}
      params.voucherCode ?? "", // {{7}}
      expiry,               // {{8}}
    ];
  } else {
    // Format registration date in bilingual format
    const dateStrAr = params.registrationDate.toLocaleDateString("ar-IQ", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const dateStrEn = params.registrationDate.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    templateName = "warranty_registration";
    const daysStr = String(params.warrantyDays);
    // 10 parameters: Arabic (1-5) then English (6-10)
    placeholders = [
      params.customerName,          // {{1}}
      params.productName,           // {{2}}
      params.voucherCode ?? "",     // {{3}}
      daysStr,                      // {{4}}
      dateStrAr,                    // {{5}}
      params.customerName,          // {{6}}
      params.productName,           // {{7}}
      params.voucherCode ?? "",     // {{8}}
      daysStr,                      // {{9}}
      dateStrEn,                    // {{10}}
    ];
  }

  return sendWhatsAppTemplate({
    phoneNumber: params.phoneNumber,
    templateName,
    placeholders,
    language: env.whatsappLang,
    shop: params.shop,
    registrationId: isVoucher ? undefined : params.registrationId,
  });
}
