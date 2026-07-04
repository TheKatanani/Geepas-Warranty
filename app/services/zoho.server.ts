/**
 * Zoho Inventory API client
 *
 * Required env vars:
 *   ZOHO_CLIENT_ID         — OAuth app client ID
 *   ZOHO_CLIENT_SECRET     — OAuth app client secret
 *   ZOHO_REFRESH_TOKEN     — long-lived refresh token (Zoho OAuth playground)
 *   ZOHO_ORGANIZATION_ID   — Zoho Inventory → Settings → Organization Profile
 *   ZOHO_REGION            — "com" | "eu" | "in" | "com.au" | "jp"  (default: "com")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZohoAddress {
  attention?: string;
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

export interface ZohoCustomerPayload {
  /** Always required — never empty. Use resolveCustomerName() before calling. */
  customer_name: string;
  /** Only include when a real value exists — never send "" or undefined */
  email?: string;
  phone?: string;
  customer_source?: string;
  billing_address?: ZohoAddress;
  shipping_address?: ZohoAddress;
  customer_type?: "business" | "individual";
  currency_code?: string;
  notes?: string;
  /**
   * Shopify customer ID (numeric string).
   * Stored as Zoho custom field cf_shopify_customer_id so future lookups
   * can match even when email/phone are absent.
   */
  shopify_customer_id?: string;
}

export interface ZohoCustomerResult {
  success: boolean;
  zohoContactId?: string;
  rawResponse?: string;
  error?: string;
  alreadyExists?: boolean;
  /** Which field was used to detect the existing record */
  matchedBy?: "email" | "phone" | "shopify_id" | "none";
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix ms
}

let tokenCache: TokenCache | null = null;

const REGION = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
const ACCOUNTS_URL = `https://accounts.zoho.${REGION}/oauth/v2/token`;
const API_BASE = `https://inventory.zoho.${REGION}/api/v1`;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Zoho credentials. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN.",
    );
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${ACCOUNTS_URL}?${params.toString()}`, { method: "POST" });

  const data = await res.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed: ${data.error ?? JSON.stringify(data)}`);
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return tokenCache.accessToken;
}

// ---------------------------------------------------------------------------
// Customer name resolver (exported so webhooks can log which branch fired)
// ---------------------------------------------------------------------------

export function resolveCustomerName(opts: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  shopifyCustomerId: number | string;
}): { name: string; resolvedBy: "name" | "email" | "phone" | "id" } {
  const first = opts.firstName?.trim() ?? "";
  const last = opts.lastName?.trim() ?? "";
  // Collapse any double-spaces that arise from one side being empty
  const fullName = `${first} ${last}`.replace(/\s+/g, " ").trim();

  if (fullName) return { name: fullName, resolvedBy: "name" };
  if (opts.email?.trim()) return { name: opts.email.trim(), resolvedBy: "email" };
  if (opts.phone?.trim()) return { name: opts.phone.trim(), resolvedBy: "phone" };
  return { name: `Shopify Customer ${opts.shopifyCustomerId}`, resolvedBy: "id" };
}

// ---------------------------------------------------------------------------
// Idempotency lookups (email → phone → cf_shopify_customer_id)
// ---------------------------------------------------------------------------

async function fetchContactList(
  params: Record<string, string>,
  accessToken: string,
  orgId: string,
): Promise<string | null> {
  const url = new URL(`${API_BASE}/contacts`);
  url.searchParams.set("organization_id", orgId);
  url.searchParams.set("contact_type", "customer");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (!res.ok) return null;

  const data = await res.json() as { contacts?: Array<{ contact_id: string }> };
  return data.contacts?.[0]?.contact_id ?? null;
}

async function findExistingContact(
  payload: ZohoCustomerPayload,
  accessToken: string,
  orgId: string,
): Promise<{ contactId: string; matchedBy: "email" | "phone" | "shopify_id" } | null> {
  // 1. Email — most reliable unique identifier
  if (payload.email) {
    const id = await fetchContactList({ email: payload.email }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "email" };
  }

  // 2. Phone — used when customer created via OTP flow (no email yet)
  if (payload.phone) {
    const id = await fetchContactList({ phone: payload.phone }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "phone" };
  }

  // 3. Shopify customer ID stored in custom field cf_shopify_customer_id
  //    Zoho custom field search: use the cf_ prefix in the search param
  if (payload.shopify_customer_id) {
    const id = await fetchContactList(
      { cf_shopify_customer_id: payload.shopify_customer_id },
      accessToken,
      orgId,
    );
    if (id) return { contactId: id, matchedBy: "shopify_id" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mandatory custom field defaults for Shopify-sourced contacts (CREATE only)
//
// These five fields are required by this Zoho org's contact schema.
// Defaults represent a safe baseline for online/Shopify customers.
// Clients can override them later via the Zoho UI or a follow-up API call.
//
//   cf_category_type        — product mix category  (ELE | LHH | MIX)
//   cf_customer_type        — payment terms         (Credit  | Cash | Consignment | Direct)
//   cf_credit_limit         — credit ceiling in org currency
//   cf_back_margin_rebate   — back-margin rebate %
//   cf_front_margin_rebate  — front-margin rebate %
// ---------------------------------------------------------------------------

const CREATE_MANDATORY_CUSTOM_FIELDS = [
  { api_name: "cf_category_type",       value: "MIX"  },
  { api_name: "cf_customer_type",       value: "Cash" },
  { api_name: "cf_credit_limit",        value: 0      },
  { api_name: "cf_back_margin_rebate",  value: 0      },
  { api_name: "cf_front_margin_rebate", value: 0      },
] as const;

// ---------------------------------------------------------------------------
// Build the Zoho contact body — strips undefined/empty, sets custom fields
// ---------------------------------------------------------------------------

function buildContactBody(
  payload: ZohoCustomerPayload,
  mode: "create" | "update",
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contact_name: payload.customer_name,
    contact_type: payload.customer_type ?? "individual",
    customer_source: payload.customer_source ?? "Shopify",
  };

  // Only include email/phone when they have a real value — never send "" or "undefined"
  if (payload.email) body.email = payload.email;
  if (payload.phone) body.phone = payload.phone;
  if (payload.notes) body.notes = payload.notes;
  if (payload.currency_code) body.currency_code = payload.currency_code;
  if (payload.billing_address) body.billing_address = payload.billing_address;
  if (payload.shipping_address) body.shipping_address = payload.shipping_address;

  // Build custom_fields array:
  //   - Always: cf_shopify_customer_id (idempotency key) + cf_customer_source
  //   - On CREATE only: mandatory org fields with safe defaults
  const customFields: Array<{ api_name: string; value: string | number }> = [
    { api_name: "cf_customer_source",    value: "Shopify" },
    ...(payload.shopify_customer_id
      ? [{ api_name: "cf_shopify_customer_id", value: payload.shopify_customer_id }]
      : []),
    ...(mode === "create" ? CREATE_MANDATORY_CUSTOM_FIELDS : []),
  ];

  body.custom_fields = customFields;

  return body;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function createZohoCustomer(
  payload: ZohoCustomerPayload,
  accessToken: string,
  orgId: string,
): Promise<{ contactId: string; raw: string }> {
  const body = buildContactBody(payload, "create");

  const res = await fetch(`${API_BASE}/contacts?organization_id=${orgId}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contact: body }),
  });

  const raw = await res.text();

  if (!res.ok) {
    // Log the full response so we can identify which field Zoho rejected
    console.error(`[Zoho] createCustomer HTTP ${res.status} — full response: ${raw}`);
    throw new Error(`Zoho createCustomer HTTP ${res.status}: ${raw}`);
  }

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error(`Zoho createCustomer non-JSON response: ${raw}`);
  }

  if (parsed.code !== 0) {
    // code 4 = invalid field value; log full body to see which field
    console.error(`[Zoho] createCustomer error code ${parsed.code} — full response: ${raw}`);
    throw new Error(`Zoho createCustomer error code ${parsed.code}: ${parsed.message}`);
  }

  const contactId = parsed.contact?.contact_id;
  if (!contactId) throw new Error(`Zoho createCustomer returned no contact_id. Raw: ${raw}`);

  return { contactId, raw };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

async function updateZohoCustomer(
  contactId: string,
  payload: ZohoCustomerPayload,
  accessToken: string,
  orgId: string,
): Promise<string> {
  const res = await fetch(`${API_BASE}/contacts/${contactId}?organization_id=${orgId}`, {
    method: "PUT",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contact: buildContactBody(payload, "update") }),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error(`[Zoho] updateCustomer HTTP ${res.status} — full response: ${raw}`);
    throw new Error(`Zoho updateCustomer HTTP ${res.status}: ${raw}`);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Public: upsert (create or update, matching by email → phone → shopify_id)
// ---------------------------------------------------------------------------

export async function upsertZohoCustomer(
  payload: ZohoCustomerPayload,
): Promise<ZohoCustomerResult> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";
  if (!orgId) {
    return { success: false, error: "ZOHO_ORGANIZATION_ID env var not set." };
  }

  // Guard: customer_name must never be empty — Zoho rejects it with code 4
  if (!payload.customer_name?.trim()) {
    return { success: false, error: "customer_name is empty — this is a caller bug." };
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err: any) {
    return { success: false, error: `Token error: ${err.message}` };
  }

  try {
    const existing = await findExistingContact(payload, accessToken, orgId);

    if (existing) {
      const raw = await updateZohoCustomer(existing.contactId, payload, accessToken, orgId);
      console.log(`[Zoho] Updated contact ${existing.contactId} (matched by ${existing.matchedBy})`);
      return {
        success: true,
        zohoContactId: existing.contactId,
        rawResponse: raw,
        alreadyExists: true,
        matchedBy: existing.matchedBy,
      };
    }

    const { contactId, raw } = await createZohoCustomer(payload, accessToken, orgId);
    console.log(`[Zoho] Created new contact ${contactId}`);
    return {
      success: true,
      zohoContactId: contactId,
      rawResponse: raw,
      alreadyExists: false,
      matchedBy: "none",
    };
  } catch (err: any) {
    console.error("[Zoho] upsertZohoCustomer failed:", err.message);
    return { success: false, error: err.message };
  }
}
