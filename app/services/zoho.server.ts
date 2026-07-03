/**
 * Zoho Inventory API client
 *
 * Required env vars:
 *   ZOHO_CLIENT_ID       — OAuth app client ID
 *   ZOHO_CLIENT_SECRET   — OAuth app client secret
 *   ZOHO_REFRESH_TOKEN   — long-lived refresh token (generate once via Zoho OAuth playground)
 *   ZOHO_ORGANIZATION_ID — found in Zoho Inventory → Settings → Organization Profile
 *   ZOHO_REGION          — "com" | "eu" | "in" | "com.au" | "jp"  (default: "com")
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
  customer_name: string;
  email?: string;
  phone?: string;
  customer_source?: string;
  billing_address?: ZohoAddress;
  shipping_address?: ZohoAddress;
  customer_type?: "business" | "individual";
  currency_code?: string;
  notes?: string;
}

export interface ZohoCustomerResult {
  success: boolean;
  zohoCustomerId?: string;
  zohoContactId?: string;
  rawResponse?: string;
  error?: string;
  alreadyExists?: boolean;
}

// ---------------------------------------------------------------------------
// Internal token cache (in-memory; refreshes automatically on expiry)
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
  // Return cached token if still valid with 60s buffer
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

  const res = await fetch(`${ACCOUNTS_URL}?${params.toString()}`, {
    method: "POST",
  });

  const data = await res.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Zoho token refresh failed: ${data.error ?? JSON.stringify(data)}`,
    );
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return tokenCache.accessToken;
}

// ---------------------------------------------------------------------------
// Idempotency: check if customer already exists by email
// ---------------------------------------------------------------------------

async function findZohoCustomerByEmail(
  email: string,
  accessToken: string,
  orgId: string,
): Promise<string | null> {
  if (!email) return null;

  const url = new URL(`${API_BASE}/contacts`);
  url.searchParams.set("organization_id", orgId);
  url.searchParams.set("email", email);
  url.searchParams.set("contact_type", "customer");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) return null;

  const data = await res.json() as { contacts?: Array<{ contact_id: string }> };
  return data.contacts?.[0]?.contact_id ?? null;
}

// ---------------------------------------------------------------------------
// Create customer
// ---------------------------------------------------------------------------

async function createZohoCustomer(
  payload: ZohoCustomerPayload,
  accessToken: string,
  orgId: string,
): Promise<{ contactId: string; raw: string }> {
  const url = `${API_BASE}/contacts?organization_id=${orgId}`;

  const body = {
    ...payload,
    contact_type: payload.customer_type ?? "individual",
    // Zoho uses "cf_customer_source" for custom fields if customer_source
    // isn't a standard field in your org. Check your Zoho field names.
    customer_source: payload.customer_source ?? "Shopify",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contact: body }),
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Zoho createCustomer HTTP ${res.status}: ${raw}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Zoho createCustomer non-JSON response: ${raw}`);
  }

  if (parsed.code !== 0) {
    throw new Error(
      `Zoho createCustomer error code ${parsed.code}: ${parsed.message}`,
    );
  }

  const contactId = parsed.contact?.contact_id;
  if (!contactId) {
    throw new Error(`Zoho createCustomer returned no contact_id. Raw: ${raw}`);
  }

  return { contactId, raw };
}

// ---------------------------------------------------------------------------
// Update existing customer (PATCH by contact_id)
// ---------------------------------------------------------------------------

async function updateZohoCustomer(
  contactId: string,
  payload: Partial<ZohoCustomerPayload>,
  accessToken: string,
  orgId: string,
): Promise<string> {
  const url = `${API_BASE}/contacts/${contactId}?organization_id=${orgId}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contact: payload }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Zoho updateCustomer HTTP ${res.status}: ${raw}`);
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Public API: upsert a customer (create or update if email already exists)
// ---------------------------------------------------------------------------

export async function upsertZohoCustomer(
  payload: ZohoCustomerPayload,
): Promise<ZohoCustomerResult> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";
  if (!orgId) {
    return { success: false, error: "ZOHO_ORGANIZATION_ID env var not set." };
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err: any) {
    return { success: false, error: `Token error: ${err.message}` };
  }

  // --- Idempotency: check if customer already exists ---
  const existingId = payload.email
    ? await findZohoCustomerByEmail(payload.email, accessToken, orgId)
    : null;

  try {
    if (existingId) {
      const raw = await updateZohoCustomer(existingId, payload, accessToken, orgId);
      console.log(`[Zoho] Updated existing customer ${existingId}`);
      return {
        success: true,
        zohoContactId: existingId,
        rawResponse: raw,
        alreadyExists: true,
      };
    }

    const { contactId, raw } = await createZohoCustomer(payload, accessToken, orgId);
    console.log(`[Zoho] Created new customer ${contactId}`);
    return {
      success: true,
      zohoContactId: contactId,
      rawResponse: raw,
      alreadyExists: false,
    };
  } catch (err: any) {
    console.error("[Zoho] upsertZohoCustomer failed:", err.message);
    return { success: false, error: err.message };
  }
}
