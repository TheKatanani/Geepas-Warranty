/**
 * Twilio SMS Service
 * Uses native fetch to send SMS via Twilio's REST API.
 * No external dependencies required.
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_SENDER_NUMBER = process.env.TWILIO_SENDER_NUMBER || "";

/**
 * Normalize a phone number to E.164 format.
 * Defaults to Iraqi format (+964...) if no country code is present (e.g. starts with 07... or 7...).
 * If it starts with + or 00, it is treated as an international number.
 */
export function normalizePhone(raw: string): string {
  // Trim and strip spaces, dashes, parentheses
  let cleaned = raw.trim().replace(/[\s\-\(\)]/g, "");

  // Check if it already starts with +
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1).replace(/\D/g, "");
    return "+" + digits;
  }

  // Check if it starts with 00 (international prefix)
  if (cleaned.startsWith("00")) {
    const digits = cleaned.slice(2).replace(/\D/g, "");
    return "+" + digits;
  }

  // Clean all non-digits for the local/national formats
  let digits = cleaned.replace(/\D/g, "");

  // If starts with 0 (local format: e.g. 07xx for Iraq), replace leading 0 with 964
  if (digits.startsWith("0")) {
    digits = "964" + digits.slice(1);
  }

  // If it starts with 7 (e.g. 77... 10 digits) and does not start with 964, assume Iraqi and prepend 964
  if (digits.length === 10 && digits.startsWith("7")) {
    digits = "964" + digits;
  }

  // If it doesn't start with 964 and is length <= 10, assume Iraqi and prepend 964
  if (!digits.startsWith("964") && digits.length <= 10) {
    digits = "964" + digits;
  }

  return "+" + digits;
}

// Keep alias for backwards compatibility/existing code references
export const normalizeIraqiPhone = normalizePhone;

export interface SendSmsResult {
  success: boolean;
  sid?: string;
  error?: string;
  rawResponse?: string;
}

/**
 * Send an SMS message via Twilio REST API.
 */
export async function sendSms(
  to: string,
  body: string
): Promise<SendSmsResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SENDER_NUMBER) {
    console.warn("[Twilio] Missing credentials, SMS not sent.");
    return {
      success: false,
      error: "Twilio credentials not configured.",
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", TWILIO_SENDER_NUMBER);
  params.set("Body", body);

  const authHeader =
    "Basic " +
    Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString(
      "base64"
    );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`[Twilio] SMS sent to ${to}, SID: ${data.sid}`);
      return {
        success: true,
        sid: data.sid,
        rawResponse: JSON.stringify(data),
      };
    } else {
      console.error(`[Twilio] SMS failed:`, data);
      return {
        success: false,
        error: data.message || "Twilio API error",
        rawResponse: JSON.stringify(data),
      };
    }
  } catch (err: any) {
    console.error(`[Twilio] Network error:`, err);
    return {
      success: false,
      error: err.message || "Network error sending SMS",
    };
  }
}

/**
 * Build warranty confirmation SMS body.
 */
export function buildWarrantyConfirmationSms(
  firstName: string,
  discountCode: string | null,
  websiteUrl: string
): string {
  if (discountCode) {
    return (
      `Hi ${firstName}, your Geepas warranty registration is confirmed! ` +
      `🎁 Use code ${discountCode} for 15% OFF your next purchase at ${websiteUrl}. ` +
      `Thank you for choosing Geepas!`
    );
  }
  return (
    `Hi ${firstName}, your Geepas warranty registration is confirmed! ` +
    `Thank you for choosing Geepas.`
  );
}
