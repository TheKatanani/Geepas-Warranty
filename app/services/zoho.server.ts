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
  billing_address?: ZohoAddress;
  shipping_address?: ZohoAddress;
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
const API_BASE = `https://www.zohoapis.${REGION}/inventory/v1`;

function requirePricebookId(): string {
  const id = process.env.ZOHO_PRICEBOOK_ID;
  if (!id) {
    throw new Error(
      "Missing ZOHO_PRICEBOOK_ID. Run `pnpm tsx scripts/list-zoho-pricebooks.ts` to find the correct ID, then set it in your env.",
    );
  }
  return id;
}

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
// Idempotency lookups (shopify_id → email → phone)
//
// shopify_id is checked first: it's written by us and is the most specific
// identifier. Checking email/phone after avoids false-positive matches on
// contacts the native Zoho↔Shopify integration created without our tag.
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
  // 1. Shopify customer ID — written by us, most specific; avoids false-positive
  //    matches on contacts the native integration created without our custom field.
  if (payload.shopify_customer_id) {
    const id = await fetchContactList(
      { cf_shopify_customer_id: payload.shopify_customer_id },
      accessToken,
      orgId,
    );
    if (id) return { contactId: id, matchedBy: "shopify_id" };
  }

  // 2. Email — reliable unique identifier; also catches contacts the native
  //    integration already created before we tagged them.
  if (payload.email) {
    const id = await fetchContactList({ email: payload.email }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "email" };
  }

  // 3. Phone — fallback for OTP-flow customers who have no email yet.
  if (payload.phone) {
    const id = await fetchContactList({ phone: payload.phone }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "phone" };
  }

  return null;
}

// Org-required custom fields sent only on CREATE (safe defaults for Shopify customers).
//   cf_category_type — product mix category (ELE | LHH | MIX)
//   cf_customer_type — payment terms (Credit | Cash | Consignment | Direct)
const CREATE_MANDATORY_CUSTOM_FIELDS = [
  { api_name: "cf_category_type", value: "MIX"  },
  { api_name: "cf_customer_type", value: "Cash" },
] as const;

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/**
 * Full body for CREATE: contact_name, contact_type, phone, notes, and all
 * four custom fields. The native Zoho↔Shopify integration will later match
 * this contact by name and won't create a duplicate.
 */
function buildCreateBody(payload: ZohoCustomerPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contact_name: payload.customer_name,
    contact_type: "customer",
    pricebook_id: requirePricebookId(),
  };

  if (payload.email) body.email = payload.email;
  if (payload.phone) body.phone = payload.phone;
  if (payload.notes) body.notes = payload.notes;
  if (payload.currency_code) body.currency_code = payload.currency_code;
  if (payload.billing_address) body.billing_address = payload.billing_address;
  if (payload.shipping_address) body.shipping_address = payload.shipping_address;

  body.custom_fields = [
    { api_name: "cf_customer_source",    value: "Shopify" },
    ...(payload.shopify_customer_id
      ? [{ api_name: "cf_shopify_customer_id", value: payload.shopify_customer_id }]
      : []),
    ...CREATE_MANDATORY_CUSTOM_FIELDS,
  ];

  return body;
}

/**
 * Enrich-only body for UPDATE: only custom_fields and notes.
 * The native integration owns contact_name/phone — we must not overwrite them.
 */
function buildEnrichBody(payload: ZohoCustomerPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (payload.notes) body.notes = payload.notes;

  body.custom_fields = [
    { api_name: "cf_customer_source", value: "Shopify" },
    ...(payload.shopify_customer_id
      ? [{ api_name: "cf_shopify_customer_id", value: payload.shopify_customer_id }]
      : []),
  ];

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
  const requestBody = JSON.stringify(buildCreateBody(payload));

  console.log(`[Zoho] createCustomer REQUEST body: ${requestBody}`);

  const res = await fetch(`${API_BASE}/contacts?organization_id=${orgId}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  const raw = await res.text();

  if (!res.ok) {
    console.error(`[Zoho] createCustomer HTTP ${res.status} — request: ${requestBody} — response: ${raw}`);
    throw new Error(`Zoho createCustomer HTTP ${res.status}: ${raw}`);
  }

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error(`Zoho createCustomer non-JSON response: ${raw}`);
  }

  if (parsed.code !== 0) {
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
  const requestBody = JSON.stringify(buildEnrichBody(payload));
  console.log(`[Zoho] enrichContact ${contactId} REQUEST body: ${requestBody}`);

  const res = await fetch(`${API_BASE}/contacts/${contactId}?organization_id=${orgId}`, {
    method: "PUT",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
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
      console.log(`[Zoho] Enriched contact ${existing.contactId} (matched by ${existing.matchedBy})`);
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

// ---------------------------------------------------------------------------
// Dev helper: list all pricebooks in the org so you can find ZOHO_PRICEBOOK_ID
// ---------------------------------------------------------------------------

export interface ZohoPricebook {
  pricebook_id: string;
  name: string;
  // Zoho returns this as "is_default" (boolean) at the top level of each entry.
  // Some API versions omit it; we treat absence as false.
  is_default?: boolean;
}

export async function listPricebooks(): Promise<ZohoPricebook[]> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";
  if (!orgId) throw new Error("ZOHO_ORGANIZATION_ID env var not set.");

  const accessToken = await getAccessToken();

  const url = new URL(`${API_BASE}/pricebooks`);
  url.searchParams.set("organization_id", orgId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Zoho listPricebooks HTTP ${res.status}: ${raw}`);

  // Zoho wraps the array under "pricebooks"; individual entries have pricebook_id + name.
  const data = JSON.parse(raw) as { pricebooks?: Array<Record<string, unknown>> };
  const books: ZohoPricebook[] = (data.pricebooks ?? []).map((b) => ({
    pricebook_id: String(b.pricebook_id ?? b.pricebook_id),
    name: String(b.name ?? ""),
    is_default: Boolean(b.is_default),
  }));

  console.log(`[Zoho] ${books.length} pricebook(s) found:`);
  for (const b of books) {
    const tag = b.is_default ? "  ← default" : "";
    console.log(`  pricebook_id=${b.pricebook_id}  name="${b.name}"${tag}`);
  }

  return books;
}