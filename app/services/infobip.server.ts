/**
 * Infobip SMS Service
 * Sends Arabic/English warranty confirmation SMS via the Infobip REST API.
 * Credentials are read from environment variables — never hardcode them here.
 *
 * Required env vars:
 *   INFOBIP_API_KEY   — your Infobip API key
 *   INFOBIP_BASE_URL  — e.g. https://8pmk3.api.infobip.com
 *   INFOBIP_SENDER    — sender ID, e.g. LUFIAN
 */

import { normalizePhone } from "../utils/twilio.server";

const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY ?? "";
const INFOBIP_BASE_URL = (process.env.INFOBIP_BASE_URL ?? "").replace(/\/$/, "");
const INFOBIP_SENDER = process.env.INFOBIP_SENDER ?? "LUFIAN";

// Deduplication window — don't send the same phone number a second SMS
// within this many milliseconds (5 minutes).
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const recentlySent = new Map<string, number>(); // phone → timestamp

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
  lang?: "ar" | "en";        // defaults to "ar"
}

export interface InfobipSmsResult {
  success: boolean;
  messageId?: string;
  phone: string;             // normalised E.164
  timestamp: string;         // ISO-8601
  error?: string;
  rawResponse?: string;
}

// ---- Message builder ------------------------------------------------------

function buildMessage(params: InfobipSmsParams): string {
  const {
    customerName,
    voucherCode,
    productName,
    warrantyDays,
    registrationId,
    registrationDate,
    voucherExpiryDays = 30,
    lang = "ar",
  } = params;

  const dateStr = registrationDate.toLocaleDateString(
    lang === "ar" ? "ar-IQ" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" },
  );

  if (lang === "ar") {
    const voucherBlock = voucherCode
      ? `\nكود الخصم الخاص بك: ${voucherCode}\nصلاحيته: ${voucherExpiryDays} يوم\n\nاستخدم الكود عند الشراء`
      : "";

    return (
      `مرحباً ${customerName}،\n\n` +
      `شكراً لتسجيل ضمان ${productName}\n` +
      `رقم الضمان: ${registrationId}\n` +
      `مدة الضمان: ${warrantyDays} يوم\n` +
      `تاريخ التسجيل: ${dateStr}` +
      voucherBlock
    );
  }

  // English fallback
  const voucherBlock = voucherCode
    ? `\nYour discount code: ${voucherCode}\nValid for: ${voucherExpiryDays} days\n\nUse the code at checkout.`
    : "";

  return (
    `Hello ${customerName},\n\n` +
    `Thank you for registering your ${productName} warranty.\n` +
    `Warranty ID: ${registrationId}\n` +
    `Duration: ${warrantyDays} days\n` +
    `Registration date: ${dateStr}` +
    voucherBlock
  );
}

// ---- Core send function ---------------------------------------------------

async function sendOnce(
  phone: string,
  message: string,
): Promise<{ success: boolean; messageId?: string; error?: string; rawResponse?: string }> {
  if (!INFOBIP_API_KEY || !INFOBIP_BASE_URL) {
    return { success: false, error: "Infobip credentials not configured (check env vars)." };
  }

  const url = `${INFOBIP_BASE_URL}/sms/2/text/advanced`;

  const payload = {
    messages: [
      {
        from: INFOBIP_SENDER,
        destinations: [{ to: phone }],
        text: message,
        smsFormat: "UNICODE",
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `App ${INFOBIP_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();

  if (!response.ok) {
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

  if (status === "PENDING" || status === "DELIVERED") {
    return { success: true, messageId: msg.messageId, rawResponse: raw };
  }

  // Infobip may return 200 with an error status inside the payload
  return {
    success: false,
    error: msg?.status?.description ?? "Unknown Infobip error",
    rawResponse: raw,
  };
}

// ---- Public API -----------------------------------------------------------

/**
 * Send a warranty confirmation SMS via Infobip.
 *
 * - Validates and normalises the phone number to E.164.
 * - Deduplicates: won't send to the same number twice within 5 minutes.
 * - Retries up to 2 times on transient failure.
 * - Logs every attempt (success and failure).
 */
export async function sendWarrantySms(
  params: InfobipSmsParams,
): Promise<InfobipSmsResult> {
  const timestamp = new Date().toISOString();

  // --- Normalise phone ---
  let phone: string;
  try {
    phone = normalizePhone(params.phoneNumber);
  } catch {
    const err = `Invalid phone number: "${params.phoneNumber}"`;
    console.error(`[Infobip] ${err}`);
    return { success: false, phone: params.phoneNumber, timestamp, error: err };
  }

  // Basic sanity check: E.164 Iraqi numbers are +964 + 10 digits = 13 chars
  if (!/^\+\d{7,15}$/.test(phone)) {
    const err = `Phone failed E.164 validation after normalisation: "${phone}"`;
    console.error(`[Infobip] ${err}`);
    return { success: false, phone, timestamp, error: err };
  }

  // --- Deduplication ---
  const lastSent = recentlySent.get(phone);
  if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
    const waitSec = Math.ceil((DEDUP_WINDOW_MS - (Date.now() - lastSent)) / 1000);
    const msg = `Duplicate suppressed — already sent to ${phone} ${Math.round((Date.now() - lastSent) / 1000)}s ago (${waitSec}s remaining)`;
    console.warn(`[Infobip] ${msg}`);
    return { success: false, phone, timestamp, error: msg };
  }

  const message = buildMessage(params);

  // --- Send with up to 2 retries ---
  const MAX_ATTEMPTS = 3;
  let lastResult: Awaited<ReturnType<typeof sendOnce>> = {
    success: false,
    error: "No attempts made",
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[Infobip] Attempt ${attempt}/${MAX_ATTEMPTS} → ${phone} (reg: ${params.registrationId})`);
    lastResult = await sendOnce(phone, message);

    if (lastResult.success) {
      recentlySent.set(phone, Date.now());
      console.log(`[Infobip] ✓ Sent to ${phone}, messageId=${lastResult.messageId}`);
      return {
        success: true,
        messageId: lastResult.messageId,
        phone,
        timestamp,
        rawResponse: lastResult.rawResponse,
      };
    }

    console.warn(`[Infobip] Attempt ${attempt} failed: ${lastResult.error}`);
    if (attempt < MAX_ATTEMPTS) {
      // Simple exponential back-off: 1s, 2s
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }

  console.error(`[Infobip] All ${MAX_ATTEMPTS} attempts failed for ${phone}:`, lastResult.error);
  return {
    success: false,
    phone,
    timestamp,
    error: lastResult.error,
    rawResponse: lastResult.rawResponse,
  };
}
