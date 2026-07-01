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

import prisma from "../db.server";
import { normalizePhone } from "../utils/twilio.server";

const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY ?? "";
const INFOBIP_BASE_URL = (process.env.INFOBIP_BASE_URL ?? "").replace(/\/$/, "");
const INFOBIP_SENDER = process.env.INFOBIP_SENDER ?? "LUFIAN";

// Deduplication window — checked against SMSLog in DB, not in-memory.
// Survives process restarts and works across multiple server instances.
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
  lang?: "ar" | "en";        // defaults to "ar"
  shop?: string;             // required for DB dedup check
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
        language: { languageCode: "AR" },
      },
    ],
  };

  console.log(`[Infobip/sendOnce] POST ${url} → ${phone}`);

  // Timeout via Promise.race — intentionally avoids AbortController.
  //
  // Why not AbortController: aborting a fetch after the Response object is
  // returned (but while the body is still streaming) throws
  // "Cannot cancel a stream that already has a reader" and crashes the process.
  // clearTimeout in a finally block does NOT prevent this because the abort
  // callback can already be queued in the JS task queue by the time finally runs.
  //
  // With Promise.race the fetch runs signal-free. If the timeout wins, the fetch
  // continues silently in the background and resolves/rejects with no listener —
  // the .catch(()=>{}) below suppresses that unhandled-rejection path.
  //
  // 8 s is generous: this code is now called from issueRewardAndNotify (a direct
  // server-side call), not from a Shopify webhook, so the old 5 s constraint is gone.
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("TIMEOUT")), 8000);
  });

  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `App ${INFOBIP_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    // no signal — avoids the stream-reader conflict on abort
  });
  // If the timeout wins the race and fetchPromise later rejects, there will be no
  // awaiting listener. Attach a no-op catch so Node never sees an unhandled rejection.
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
    console.error(`[Infobip/sendOnce] HTTP ${response.status} for ${phone} — body: ${raw}`);
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

  // ACCEPTED = queued for delivery (most common immediate response)
  // PENDING  = awaiting delivery confirmation
  // DELIVERED = confirmed delivered
  if (status === "ACCEPTED" || status === "PENDING" || status === "DELIVERED") {
    return { success: true, messageId: msg.messageId, rawResponse: raw };
  }

  // Infobip may return 200 with an error status inside the payload
  const errDesc = msg?.status?.description ?? `Unexpected Infobip status: ${status}`;
  console.error(`[Infobip/sendOnce] Non-success status for ${phone} — ${errDesc} — body: ${raw}`);
  return {
    success: false,
    error: errDesc,
    rawResponse: raw,
  };
}

// ---- Public API -----------------------------------------------------------

/**
 * Send a warranty confirmation SMS via Infobip.
 *
 * - Validates and normalises the phone number to E.164.
 * - Deduplicates via SMSLog DB query (survives restarts and multi-instance deploys).
 * - Single attempt with 8s timeout (no Shopify webhook constraint — called directly
 *   from issueRewardAndNotify server-side). Transient failures are logged and surfaced
 *   to the caller; the warranty registration always succeeds regardless.
 * - Returns isDuplicate=true when dedup fires so the caller can still clean up the tag.
 */
export async function sendWarrantySms(
  params: InfobipSmsParams,
): Promise<InfobipSmsResult & { isDuplicate?: boolean }> {
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

  // --- DB-backed deduplication ---
  // Checks SMSLog so state is shared across all server instances and survives restarts.
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
      console.warn(`[Infobip] ${msg}`);
      return { success: false, isDuplicate: true, phone, timestamp, error: msg };
    }
  } catch (dedupErr) {
    // Non-fatal: if DB check fails, proceed and let the SMS send rather than block it.
    console.warn(`[Infobip] Dedup DB check failed (proceeding):`, dedupErr);
  }

  const message = buildMessage(params);

  // Single attempt — called directly from issueRewardAndNotify, not a webhook.
  // sendOnce has an 8s timeout; failures are logged and returned to the caller.
  console.log(`[Infobip] Sending → ${phone} (reg: ${params.registrationId})`);
  const result = await sendOnce(phone, message);

  if (result.success) {
    console.log(`[Infobip] ✓ Sent to ${phone}, messageId=${result.messageId}`);
    return {
      success: true,
      messageId: result.messageId,
      phone,
      timestamp,
      rawResponse: result.rawResponse,
    };
  }

  console.error(`[Infobip] Send failed for ${phone}:`, result.error);
  return {
    success: false,
    phone,
    timestamp,
    error: result.error,
    rawResponse: result.rawResponse,
  };
}
