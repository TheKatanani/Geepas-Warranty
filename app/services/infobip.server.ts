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
    // Must exactly match the language code of the approved Meta template.
    // "Arabic (UAE)" in Infobip/Meta portal → language code "ar_AE"
    // (Meta uses underscore-separated locale codes, NOT BCP-47 hyphens.)
    // Override via INFOBIP_WHATSAPP_LANG env var if needed.
    whatsappLang: process.env.INFOBIP_WHATSAPP_LANG ?? "ar_AE",
  };
}

// Deduplication window — checked against SMSLog in DB, not in-memory.
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// ---- Template registry -------------------------------------------------------
// Maps every known template name to its expected placeholder count.
// Update this whenever a new template is added or an existing one is changed.
const TEMPLATE_REGISTRY: Record<string, { expectedParams: number; language: string }> = {
  voucher_code:           { expectedParams: 8,  language: "ar" },      // Template language: "Arabic"
  warranty_registration:  { expectedParams: 10, language: "ar_AE" },   // Template language: "Arabic (UAE)"
  gift_card_notification: { expectedParams: 6,  language: "ar" },      // Template language: "Arabic"
};

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
  phoneNumber: string;       // raw input — will be normalised to E.164
  templateName: string;
  placeholders: string[];
  language?: string;
  mediaUrl?: string;          // Optional image/media header for MEDIA_TEMPLATE templates
  shop?: string;
  registrationId?: string;
  dedupeKey?: string;
}

// ---- Helper: safe string value -----------------------------------------------
/**
 * Converts any value to a non-empty string.
 * Returns `fallback` (default "-") when the value is null, undefined, or blank.
 * Use this for every template placeholder to prevent Meta error 7009.
 */
function safeValue(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str === "" ? fallback : str;
}

// ---- Helper: extract discount percentage ----
function extractDiscountPercentage(rewardType?: string, passedPct?: number): number {
  if (passedPct !== undefined && passedPct !== null) return passedPct;
  if (!rewardType) return 15; // default fallback
  const match = rewardType.match(/\d+/);
  return match ? parseInt(match[0], 10) : 15;
}

// ---- Pre-send validation -----------------------------------------------------
/**
 * Validates template name, language, and parameter count before hitting the API.
 * Returns a descriptive error string on failure, or null when all checks pass.
 */
function validateTemplate(
  templateName: string,
  language: string,
  placeholders: string[]
): string | null {
  const reg = TEMPLATE_REGISTRY[templateName];
  if (!reg) {
    // Unknown template — warn but allow send so newly created templates work without code changes
    console.warn(
      `[Infobip/validateTemplate] Template "${templateName}" is not in local TEMPLATE_REGISTRY (proceeding with send).`
    );
    return null;
  }

  if (placeholders.length !== reg.expectedParams) {
    return (
      `Template "${templateName}" expects ${reg.expectedParams} placeholders ` +
      `but received ${placeholders.length}: ${JSON.stringify(placeholders)}`
    );
  }

  return null; // all good
}

// ---- Core send function ---------------------------------------------------

async function sendWhatsAppOnce(
  phone: string,
  templateName: string,
  placeholders: string[],
  language: string,
  mediaUrl?: string
): Promise<{ success: boolean; messageId?: string; error?: string; rawResponse?: string }> {
  const env = getEnv();

  if (!env.apiKey || !env.baseUrl) {
    return { success: false, error: "Infobip credentials not configured (check env vars)." };
  }
  if (!env.whatsappSender) {
    return { success: false, error: "INFOBIP_WHATSAPP_SENDER not configured." };
  }

  // Pre-send validation
  const validationError = validateTemplate(templateName, language, placeholders);
  if (validationError) {
    console.error(`[Infobip/sendWhatsAppOnce] Validation failed — ${validationError}`);
    return { success: false, error: `Template validation failed: ${validationError}` };
  }

  const url = `${env.baseUrl}/whatsapp/1/message/template`;

  const templateData: any = {
    body: {
      placeholders,
    },
  };

  const activeMediaUrl = mediaUrl || process.env.INFOBIP_GIFT_CARD_MEDIA_URL;
  if (activeMediaUrl || templateName === "gift_card_notification") {
    const finalMediaUrl =
      activeMediaUrl ||
      process.env.INFOBIP_GIFT_CARD_MEDIA_URL ||
      "https://cdn.shopify.com/s/files/1/0820/2226/9219/files/21.jpg?v=1693751983";

    templateData.header = {
      type: "IMAGE",
      mediaUrl: finalMediaUrl,
    };
  }

  const payload = {
    messages: [
      {
        from: env.whatsappSender,
        to: phone,
        content: {
          templateName,
          templateData,
          language,
        },
      },
    ],
  };

  // Log full payload (no credentials — they are in headers, not body)
  const payloadJson = JSON.stringify(payload, null, 2);
  console.log(
    `[Infobip/sendWhatsAppOnce] POST ${url} → ${phone}\n` +
      `  template: ${templateName} | language: ${language} | params(${placeholders.length}): ${JSON.stringify(placeholders)}\n` +
      `  Full payload:\n${payloadJson}`
  );

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

  // Log response headers for debugging (exclude auth-related headers)
  const respHeaders: Record<string, string> = {};
  if (response.headers?.forEach) {
    response.headers.forEach((v: string, k: string) => {
      if (!k.toLowerCase().includes("authorization")) respHeaders[k] = v;
    });
  }
  console.log(
    `[Infobip/sendWhatsAppOnce] Response ${response.status} for ${phone}\n` +
      `  Headers: ${JSON.stringify(respHeaders)}\n` +
      `  Body: ${raw}`
  );

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

  // Sanitize all placeholders before sending
  const safePlaceholders = params.placeholders.map((p) => safeValue(p));

  const result = await sendWhatsAppOnce(phone, params.templateName, safePlaceholders, language, params.mediaUrl);

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
      safeValue(params.customerName),   // {{1}}
      safeValue(pct),                   // {{2}}
      safeValue(params.voucherCode),    // {{3}}
      safeValue(expiry),                // {{4}}
      safeValue(params.customerName),   // {{5}}
      safeValue(pct),                   // {{6}}
      safeValue(params.voucherCode),    // {{7}}
      safeValue(expiry),                // {{8}}
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
      safeValue(params.customerName),   // {{1}}
      safeValue(params.productName),    // {{2}}
      safeValue(params.voucherCode),    // {{3}} — discount code issued with warranty
      safeValue(daysStr),               // {{4}}
      safeValue(dateStrAr),             // {{5}}
      safeValue(params.customerName),   // {{6}}
      safeValue(params.productName),    // {{7}}
      safeValue(params.voucherCode),    // {{8}} — discount code (English side)
      safeValue(daysStr),               // {{9}}
      safeValue(dateStrEn),             // {{10}}
    ];
  }

  const templateLang = TEMPLATE_REGISTRY[templateName]?.language ?? env.whatsappLang;

  return sendWhatsAppTemplate({
    phoneNumber: params.phoneNumber,
    templateName,
    placeholders,
    language: templateLang,
    shop: params.shop,
    registrationId: isVoucher ? undefined : params.registrationId,
  });
}
