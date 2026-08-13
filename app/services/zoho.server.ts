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
  /** Separate name parts — used for contact_persons.is_primary_contact on create */
  first_name?: string;
  last_name?: string;
  /** Only include when a real value exists — never send "" or undefined */
  email?: string;
  phone?: string;
  billing_address?: ZohoAddress;
  shipping_address?: ZohoAddress;
  currency_code?: string;
  notes?: string;
  /**
   * Shopify customer ID (numeric string).
   * Written to cf_shopify_customer_id on create/enrich for traceability.
   * Cannot be used for lookup — cf_shopify_customer_id is an ENCRYPTED PII
   * field in this org; Zoho does not allow searching encrypted custom fields.
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
  matchedBy?: "phone" | "email" | "contact_name" | "none";
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

// ---------------------------------------------------------------------------
// Pricebook resolver
//
// The org rotates "ONLINE RSP" pricebooks monthly (e.g. "ONLINE RSP MAY 26").
// We auto-discover the currently active online sales pricebook so deploys
// don't need manual env updates every month.
//
// Selection criteria (all must match):
//   status                 === "active"
//   sales_or_purchase_type === "sales"
//   name                   matches /online/i
//
// If multiple match, pick the most recently modified (latest last_modified_time).
// Falls back to ZOHO_PRICEBOOK_ID env var, then throws if neither resolves.
// Cache TTL: 6 hours — long enough to avoid hammering the API, short enough
// to pick up a monthly rotation within the same serverless instance lifetime.
// ---------------------------------------------------------------------------

interface PricebookCache {
  pricebookId: string;
  pricebookName: string;
  expiresAt: number;
}

let pricebookCache: PricebookCache | null = null;
const PRICEBOOK_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function resolveOnlinePricebookId(
  accessToken: string,
  orgId: string,
): Promise<string> {
  if (pricebookCache && Date.now() < pricebookCache.expiresAt) {
    return pricebookCache.pricebookId;
  }

  const url = new URL(`${API_BASE}/pricebooks`);
  url.searchParams.set("organization_id", orgId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`Zoho listPricebooks HTTP ${res.status}: ${raw}`);
  }

  const data = await res.json() as {
    pricebooks?: Array<{
      pricebook_id: string;
      name: string;
      status: string;
      sales_or_purchase_type?: string;
      last_modified_time?: string;
    }>;
  };

  const candidates = (data.pricebooks ?? []).filter(
    (b) =>
      b.status?.toLowerCase() === "active" &&
      b.sales_or_purchase_type?.toLowerCase() === "sales" &&
      /online/i.test(b.name),
  );

  let resolved: { pricebook_id: string; name: string } | null = null;

  if (candidates.length > 0) {
    // Pick the most recently modified when multiple match (monthly rotation)
    candidates.sort((a, b) => {
      const ta = a.last_modified_time ? new Date(a.last_modified_time).getTime() : 0;
      const tb = b.last_modified_time ? new Date(b.last_modified_time).getTime() : 0;
      return tb - ta;
    });
    resolved = candidates[0];
  }

  if (!resolved) {
    // Fall back to env var if auto-discovery finds nothing
    const envId = process.env.ZOHO_PRICEBOOK_ID;
    if (envId) {
      console.warn(
        `[Zoho] No active online sales pricebook found — falling back to ZOHO_PRICEBOOK_ID=${envId}`,
      );
      pricebookCache = { pricebookId: envId, pricebookName: "(from env)", expiresAt: Date.now() + PRICEBOOK_TTL_MS };
      return envId;
    }
    throw new Error(
      "No active online sales pricebook found and ZOHO_PRICEBOOK_ID is not set. " +
      "Run `pnpm inspect-zoho-contact` to inspect the org's pricebooks.",
    );
  }

  console.log(`[Zoho] Resolved pricebook: id=${resolved.pricebook_id} name="${resolved.name}"`);
  pricebookCache = {
    pricebookId: resolved.pricebook_id,
    pricebookName: resolved.name,
    expiresAt: Date.now() + PRICEBOOK_TTL_MS,
  };
  return resolved.pricebook_id;
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
// Idempotency lookups — order: phone → email → contact_name
//
// cf_shopify_customer_id is an ENCRYPTED PII field in this org; Zoho blocks
// searching encrypted custom fields (returns empty results silently). We still
// WRITE it on create/enrich so it's visible in the Zoho UI, but we cannot use
// it as a search key. Search by phone first (most stable for OTP-flow
// customers), then email, then contact_name as a last resort.
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
): Promise<{ contactId: string; matchedBy: "phone" | "email" | "contact_name" } | null> {
  // 1. Phone — most stable for OTP-flow customers who register before adding email.
  if (payload.phone) {
    const id = await fetchContactList({ phone: payload.phone }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "phone" };
  }

  // 2. Email — reliable unique identifier for customers who signed up with email.
  if (payload.email) {
    const id = await fetchContactList({ email: payload.email }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "email" };
  }

  // 3. contact_name — last resort; may match unrelated contacts if names collide.
  //    Only used when neither phone nor email is available.
  if (payload.customer_name) {
    const id = await fetchContactList({ contact_name: payload.customer_name }, accessToken, orgId);
    if (id) return { contactId: id, matchedBy: "contact_name" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Custom fields
//
// CREATE sends six custom fields verified against the org's field configuration:
//   cf_back_margin_rebate — Percent, mandatory, no default → send 0
//   cf_front_margin_rebate— Percent, mandatory, no default → send 0
//   cf_category_type      — Dropdown: ELE | LHH | MIX
//   cf_customer_type      — Dropdown: "Credit " | "Cash " | ... (note trailing spaces)
//   cf_customer_source    — Dropdown: Shopify | ...
//   cf_shopify_customer_id— Encrypted text; write-only (search is blocked by Zoho)
//
// "Price List" is NOT a custom field — it is Zoho's native pricebook association
// sent as pricebook_id at the top level of the create body (from ZOHO_PRICEBOOK_ID).
//
// cf_credit_limit is mandatory but has a default of 2 000 000 that Zoho
// auto-applies; sending any value triggers input-format errors — omit it.
//
// ENRICH (update) sends only cf_customer_source + cf_shopify_customer_id so we
// don't overwrite values the native Zoho↔Shopify integration manages.
//
// WARNING — trailing spaces: the org's dropdown options for cf_customer_type
// appear to include trailing spaces (e.g. "Cash " not "Cash"). Run
// `pnpm inspect-zoho-contact` on a real contact and check the exact value
// in the output. Update CF_CUSTOMER_TYPE_VALUE below if needed.
// ---------------------------------------------------------------------------

const CF_CUSTOMER_TYPE_VALUE = "Cash"; // update to "Cash " if Zoho rejects this

const KNOWN_CUSTOMER_TYPE_VALUES = ["Cash", "Cash ", "Credit", "Credit ", "Consignment", "Consignment ", "Direct", "Direct "];

const CREATE_CUSTOM_FIELDS = [
  { api_name: "cf_back_margin_rebate",  value: 0                    },
  { api_name: "cf_front_margin_rebate", value: 0                    },
  { api_name: "cf_category_type",       value: "MIX"                },
  { api_name: "cf_customer_type",       value: CF_CUSTOMER_TYPE_VALUE },
  { api_name: "cf_customer_source",     value: "Shopify"            },
] as const satisfies Array<{ api_name: string; value: string | number }>;

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/**
 * Full body for CREATE. pricebook_id is resolved dynamically (auto-discovery
 * with env fallback). The native Zoho↔Shopify integration will later match
 * this contact by name and won't create a duplicate.
 */
async function buildCreateBody(
  payload: ZohoCustomerPayload,
  accessToken: string,
  orgId: string,
): Promise<Record<string, unknown>> {
  // Warn if the dropdown value we're about to send isn't in the known option list.
  // Zoho dropdown fields in this org may have trailing spaces (e.g. "Cash " not "Cash").
  // If a create fails with "invalid value for cf_customer_type", check real contacts
  // with `pnpm inspect-zoho-contact` and update CF_CUSTOMER_TYPE_VALUE.
  if (!KNOWN_CUSTOMER_TYPE_VALUES.includes(CF_CUSTOMER_TYPE_VALUE)) {
    console.warn(`[Zoho] CF_CUSTOMER_TYPE_VALUE="${CF_CUSTOMER_TYPE_VALUE}" is not in the known options list — Zoho may reject it`);
  }

  // "Price List" is Zoho's native pricebook association — sent as a top-level
  // field, NOT as a custom field. Auto-discovered from active online sales
  // pricebooks; falls back to ZOHO_PRICEBOOK_ID env var.
  const pricebookId = await resolveOnlinePricebookId(accessToken, orgId);

  const body: Record<string, unknown> = {
    contact_name: payload.customer_name,
    contact_type: "customer",
    pricebook_id: pricebookId,
  };

  if (payload.email) body.email = payload.email;
  if (payload.phone) body.phone = payload.phone;
  if (payload.notes) body.notes = payload.notes;
  if (payload.currency_code) body.currency_code = payload.currency_code;
  if (payload.billing_address) body.billing_address = payload.billing_address;
  if (payload.shipping_address) body.shipping_address = payload.shipping_address;

  // Ensure Zoho shows a primary contact with email/phone in the UI and enables
  // native Zoho↔Shopify email-based matching. Keep top-level phone as well.
  body.contact_persons = [
    {
      ...(payload.first_name ? { first_name: payload.first_name } : {}),
      ...(payload.last_name ? { last_name: payload.last_name } : {}),
      ...(payload.email ? { email: payload.email } : {}),
      ...(payload.phone ? { phone: payload.phone } : {}),
      is_primary_contact: true,
    },
  ];

  body.custom_fields = [
    ...CREATE_CUSTOM_FIELDS,
    ...(payload.shopify_customer_id
      ? [{ api_name: "cf_shopify_customer_id", value: payload.shopify_customer_id }]
      : []),
  ];

  return body;
}

/**
 * Enrich-only body for UPDATE: only notes + the two traceability custom fields.
 * The native integration owns contact_name/phone/price_list — we must not
 * overwrite them.
 */
function buildEnrichBody(payload: ZohoCustomerPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (payload.notes) body.notes = payload.notes;

  // When email is present on update, also ensure Zoho has a primary contact
  // person with that email. This does not change top-level Zoho fields that
  // the native integration manages (contact_name/pricebook/phone, etc.).
  if (payload.email) {
    body.contact_persons = [
      {
        ...(payload.first_name ? { first_name: payload.first_name } : {}),
        ...(payload.last_name ? { last_name: payload.last_name } : {}),
        email: payload.email,
        ...(payload.phone ? { phone: payload.phone } : {}),
        is_primary_contact: true,
      },
    ];
  }

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
  const requestBody = JSON.stringify(await buildCreateBody(payload, accessToken, orgId));

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
// Update (enrich)
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
// Public: upsert (find existing → enrich, or create)
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
// Dev helper: list all pricebooks in the org
// ---------------------------------------------------------------------------

export interface ZohoPricebook {
  pricebook_id: string;
  name: string;
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

  const data = JSON.parse(raw) as { pricebooks?: Array<Record<string, unknown>> };
  const books: ZohoPricebook[] = (data.pricebooks ?? []).map((b) => ({
    pricebook_id: String(b.pricebook_id),
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

// ---------------------------------------------------------------------------
// Item list & CSV Parsing helpers
// ---------------------------------------------------------------------------

export interface ZohoItem {
  item_id: string;
  name: string;
  sku: string;
  upc?: string;
  ean?: string;
  description?: string;
  rate: number;
  purchase_rate?: number;
  stock_on_hand?: number;
  brand?: string;
  category_name?: string;
  status?: string;
  unit?: string;
  location_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
}

export async function fetchZohoItems(options: { warehouseId?: string } = {}): Promise<ZohoItem[]> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";
  if (!orgId) throw new Error("ZOHO_ORGANIZATION_ID env var not set.");

  const accessToken = await getAccessToken();
  const items: ZohoItem[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${API_BASE}/items`);
    url.searchParams.set("organization_id", orgId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "200");
    url.searchParams.set("status", "active");
    if (options.warehouseId) {
      url.searchParams.set("warehouse_id", options.warehouseId);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(`Zoho listItems HTTP ${res.status}: ${raw}`);

    const data = JSON.parse(raw) as {
      code?: number;
      message?: string;
      items?: Array<Record<string, any>>;
      page_context?: { page: number; per_page: number; has_more_page: boolean };
    };

    if (data.code !== 0) {
      throw new Error(`Zoho listItems error ${data.code}: ${data.message}`);
    }

    const fetched = data.items ?? [];
    for (const item of fetched) {
      const rateNum = typeof item.rate === "number"
        ? item.rate
        : parseFloat(String(item.rate ?? "0").replace(/[^0-9.]/g, ""));
      const stockNum = typeof item.stock_on_hand === "number"
        ? item.stock_on_hand
        : parseFloat(String(item.stock_on_hand ?? "0").replace(/[^0-9.]/g, ""));

      items.push({
        item_id: String(item.item_id),
        name: String(item.name || item.item_name || ""),
        sku: String(item.sku || "").trim(),
        upc: item.upc ? String(item.upc).trim() : undefined,
        ean: item.ean ? String(item.ean).trim() : undefined,
        description: item.description || item.sales_description ? String(item.description || item.sales_description) : undefined,
        rate: isNaN(rateNum) ? 0 : rateNum,
        stock_on_hand: isNaN(stockNum) ? 0 : stockNum,
        brand: item.brand ? String(item.brand) : undefined,
        category_name: item.category_name ? String(item.category_name) : undefined,
        status: item.status ? String(item.status) : undefined,
        unit: item.unit ? String(item.unit) : undefined,
        location_name: item.location_name ? String(item.location_name) : undefined,
        warehouse_id: item.warehouse_id ? String(item.warehouse_id) : undefined,
        warehouse_name: item.warehouse_name ? String(item.warehouse_name) : undefined,
      });
    }

    hasMore = Boolean(data.page_context?.has_more_page);
    page++;
    if (page > 50) break; // Safety cap
  }

  return items;
}

/**
 * Parses raw CSV content exported from Zoho Inventory (Item.csv) into ZohoItem array.
 */
export function parseZohoCsv(csvContent: string): ZohoItem[] {
  const lines: string[] = [];
  let currentLine = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csvContent[i + 1] === "\n") i++;
      if (currentLine.trim()) lines.push(currentLine);
      currentLine = "";
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let inside = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inside && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inside = !inside;
        }
      } else if (c === ',' && !inside) {
        fields.push(field.trim());
        field = "";
      } else {
        field += c;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const getIdx = (colName: string) => headers.findIndex(h => h.toLowerCase() === colName.toLowerCase());

  const itemIdIdx = getIdx("Item ID");
  const itemNameIdx = getIdx("Item Name");
  const skuIdx = getIdx("SKU");
  const upcIdx = getIdx("UPC");
  const eanIdx = getIdx("EAN");
  const descIdx = getIdx("Sales Description");
  const priceIdx = getIdx("Selling Price");
  const stockIdx = getIdx("Stock On Hand");
  const brandIdx = getIdx("Brand");
  const categoryIdx = getIdx("Category Name");
  const statusIdx = getIdx("Status");
  const unitIdx = getIdx("Unit");
  const locationIdx = getIdx("Location Name");

  const items: ZohoItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    const sku = (skuIdx !== -1 ? row[skuIdx] : "").trim();
    const name = (itemNameIdx !== -1 ? row[itemNameIdx] : "").trim();
    if (!sku && !name) continue;

    const priceRaw = priceIdx !== -1 ? row[priceIdx] : "0";
    const priceNum = parseFloat(priceRaw.replace(/[^0-9.]/g, "")) || 0;

    const stockRaw = stockIdx !== -1 ? row[stockIdx] : "0";
    const stockNum = parseFloat(stockRaw.replace(/[^0-9.-]/g, "")) || 0;

    const locationName = locationIdx !== -1 && row[locationIdx] ? row[locationIdx] : undefined;

    items.push({
      item_id: itemIdIdx !== -1 ? row[itemIdIdx] : "",
      name: name || sku,
      sku: sku,
      upc: upcIdx !== -1 && row[upcIdx] ? row[upcIdx] : undefined,
      ean: eanIdx !== -1 && row[eanIdx] ? row[eanIdx] : undefined,
      description: descIdx !== -1 && row[descIdx] ? row[descIdx] : undefined,
      rate: priceNum,
      stock_on_hand: stockNum,
      brand: brandIdx !== -1 && row[brandIdx] ? row[brandIdx] : "GEEPAS",
      category_name: categoryIdx !== -1 && row[categoryIdx] ? row[categoryIdx] : undefined,
      status: statusIdx !== -1 && row[statusIdx] ? row[statusIdx] : "Active",
      unit: unitIdx !== -1 && row[unitIdx] ? row[unitIdx] : undefined,
      location_name: locationName,
      warehouse_name: locationName,
    });
  }

  return items;
}


