/**
 * Tests for zoho.server.ts body builders, pricebook resolver, and lookup order.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Realistic pricebook fixtures
// ---------------------------------------------------------------------------

const PRICEBOOKS = [
  // inactive — should never be selected
  {
    pricebook_id: "4516918000003364347",
    name: "ONLINE RSP",
    status: "inactive",
    sales_or_purchase_type: "sales",
    last_modified_time: "2025-01-01T00:00:00Z",
  },
  // active online sales — CORRECT choice (most recent)
  {
    pricebook_id: "4516918000033680134",
    name: "ONLINE RSP MAY 26",
    status: "active",
    sales_or_purchase_type: "sales",
    last_modified_time: "2026-05-01T00:00:00Z",
  },
  // active but NOT online — must be ignored
  {
    pricebook_id: "4516918000023690060",
    name: "WSP NOV 25",
    status: "active",
    sales_or_purchase_type: "sales",
    last_modified_time: "2025-11-01T00:00:00Z",
  },
  // active but back-margin (not online, not sales) — must be ignored
  {
    pricebook_id: "4516918000000101337",
    name: "10% BACK MARGIN",
    status: "active",
    sales_or_purchase_type: "purchase",
    last_modified_time: "2024-01-01T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Shared fetch mock factory
// ---------------------------------------------------------------------------

type CapturedCall = { url: string; method: string; body: Record<string, unknown> | null };

function mockFetch(opts: {
  existingContactId?: string;
  /** Return these pricebooks; defaults to PRICEBOOKS fixture */
  pricebooks?: typeof PRICEBOOKS;
  /** Simulate pricebooks endpoint failure */
  pricebooksError?: boolean;
}): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const books = opts.pricebooks ?? PRICEBOOKS;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url, method, body });

      if ((url as string).includes("accounts.zoho")) {
        return new Response(
          JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
          { status: 200 },
        );
      }

      if ((url as string).includes("/pricebooks")) {
        if (opts.pricebooksError) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(JSON.stringify({ pricebooks: books }), { status: 200 });
      }

      if (method === "GET" && (url as string).includes("/contacts")) {
        const contacts = opts.existingContactId
          ? [{ contact_id: opts.existingContactId }]
          : [];
        return new Response(JSON.stringify({ contacts }), { status: 200 });
      }

      if (method === "POST" && (url as string).includes("/contacts")) {
        return new Response(
          JSON.stringify({ code: 0, contact: { contact_id: "new-contact-123" } }),
          { status: 200 },
        );
      }

      if (method === "PUT" && (url as string).includes("/contacts/")) {
        return new Response(
          JSON.stringify({ code: 0, contact: { contact_id: opts.existingContactId } }),
          { status: 200 },
        );
      }

      return new Response("{}", { status: 200 });
    }),
  );

  return { calls };
}

// ---------------------------------------------------------------------------
// resolveOnlinePricebookId
// ---------------------------------------------------------------------------

describe("resolveOnlinePricebookId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.ZOHO_PRICEBOOK_ID;
  });

  it("selects the active online sales pricebook (ONLINE RSP MAY 26)", async () => {
    mockFetch({});
    const { resolveOnlinePricebookId } = await import("./zoho.server.js");
    const id = await resolveOnlinePricebookId("test-token", "test-org");
    expect(id).toBe("4516918000033680134");
  });

  it("ignores inactive pricebooks even if they match /online/i", async () => {
    // Only the inactive ONLINE RSP and the active but non-online ones
    mockFetch({
      pricebooks: [
        { pricebook_id: "inactive-online", name: "ONLINE RSP", status: "inactive", sales_or_purchase_type: "sales", last_modified_time: "2025-01-01T00:00:00Z" },
        { pricebook_id: "active-wsp", name: "WSP NOV 25", status: "active", sales_or_purchase_type: "sales", last_modified_time: "2025-11-01T00:00:00Z" },
      ],
    });
    process.env.ZOHO_PRICEBOOK_ID = "env-fallback-id";
    const { resolveOnlinePricebookId } = await import("./zoho.server.js");
    const id = await resolveOnlinePricebookId("test-token", "test-org");
    expect(id).toBe("env-fallback-id");
  });

  it("falls back to ZOHO_PRICEBOOK_ID env var when no online pricebook matches", async () => {
    mockFetch({ pricebooks: [] });
    process.env.ZOHO_PRICEBOOK_ID = "4516918000033680134";
    const { resolveOnlinePricebookId } = await import("./zoho.server.js");
    const id = await resolveOnlinePricebookId("test-token", "test-org");
    expect(id).toBe("4516918000033680134");
  });

  it("throws a clear error when nothing matches and env var is absent", async () => {
    mockFetch({ pricebooks: [] });
    const { resolveOnlinePricebookId } = await import("./zoho.server.js");
    await expect(resolveOnlinePricebookId("test-token", "test-org")).rejects.toThrow(
      /ZOHO_PRICEBOOK_ID/,
    );
  });

  it("picks the most recently modified when multiple active online pricebooks exist", async () => {
    mockFetch({
      pricebooks: [
        { pricebook_id: "older", name: "ONLINE RSP MAR 26", status: "active", sales_or_purchase_type: "sales", last_modified_time: "2026-03-01T00:00:00Z" },
        { pricebook_id: "newer", name: "ONLINE RSP MAY 26", status: "active", sales_or_purchase_type: "sales", last_modified_time: "2026-05-01T00:00:00Z" },
      ],
    });
    const { resolveOnlinePricebookId } = await import("./zoho.server.js");
    const id = await resolveOnlinePricebookId("test-token", "test-org");
    expect(id).toBe("newer");
  });
});

// ---------------------------------------------------------------------------
// buildCreateBody
// ---------------------------------------------------------------------------

describe("buildCreateBody", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.ZOHO_PRICEBOOK_ID;
  });

  it("sends pricebook_id at the top level (auto-discovered)", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Sameer", phone: "+9647701234567", shopify_customer_id: "22222" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post?.body?.pricebook_id).toBe("4516918000033680134");
    expect(post?.body?.contact_name).toBe("Sameer");
    expect(post?.body?.contact_type).toBe("customer");
  });

  it("includes contact_persons with is_primary_contact and carries first/last/email/phone", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "moha zaqout",
      first_name: "moha",
      last_name: "zaqout",
      email: "mohazaqout@gmail.com",
      phone: "+972 59-226-3505",
      shopify_customer_id: "12345",
    });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    const persons = post?.body?.contact_persons as Array<any> | undefined;
    expect(Array.isArray(persons)).toBe(true);
    expect(persons?.[0]?.is_primary_contact).toBe(true);
    expect(persons?.[0]?.first_name).toBe("moha");
    expect(persons?.[0]?.last_name).toBe("zaqout");
    expect(persons?.[0]?.email).toBe("mohazaqout@gmail.com");
    expect(persons?.[0]?.phone).toBe("+972 59-226-3505");
  });

  it("does NOT send pricebook_id inside custom_fields", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", shopify_customer_id: "11111" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    const fields = post?.body?.custom_fields as Array<{ api_name: string }>;
    expect(fields.map((f) => f.api_name)).not.toContain("pricebook_id");
    expect(fields.map((f) => f.api_name)).not.toContain("cf_price_list");
  });

  it("sends all six required custom fields", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", phone: "+9647701234567", shopify_customer_id: "22222" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    const fields = post?.body?.custom_fields as Array<{ api_name: string; value: unknown }>;
    const byName = Object.fromEntries(fields.map((f) => [f.api_name, f.value]));

    expect(byName["cf_back_margin_rebate"]).toBe(0);
    expect(byName["cf_front_margin_rebate"]).toBe(0);
    expect(byName["cf_category_type"]).toBe("MIX");
    expect(byName["cf_customer_type"]).toBeDefined();
    expect(byName["cf_customer_source"]).toBe("Shopify");
    expect(byName["cf_shopify_customer_id"]).toBe("22222");
  });

  it("does NOT send cf_credit_limit (Zoho auto-applies its 2 000 000 default)", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", shopify_customer_id: "11111" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    const fields = post?.body?.custom_fields as Array<{ api_name: string }>;
    expect(fields.map((f) => f.api_name)).not.toContain("cf_credit_limit");
  });

  it("uses env fallback when pricebook discovery fails", async () => {
    process.env.ZOHO_PRICEBOOK_ID = "env-fallback-id";
    const { calls } = mockFetch({ pricebooks: [] });
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", shopify_customer_id: "11111" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post?.body?.pricebook_id).toBe("env-fallback-id");
  });

  it("includes contact_persons with is_primary_contact, full name, email, and phone on create", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "moha zaqout",
      first_name: "moha",
      last_name: "zaqout",
      email: "mohazaqout@gmail.com",
      phone: "+97259226350",
      shopify_customer_id: "11533125386531",
    });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post).toBeDefined();

    // top-level email must also be present
    expect(post?.body?.email).toBe("mohazaqout@gmail.com");

    const persons = post?.body?.contact_persons as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(persons)).toBe(true);
    expect(persons).toHaveLength(1);
    expect(persons?.[0]?.is_primary_contact).toBe(true);
    expect(persons?.[0]?.first_name).toBe("moha");
    expect(persons?.[0]?.last_name).toBe("zaqout");
    expect(persons?.[0]?.email).toBe("mohazaqout@gmail.com");
    expect(persons?.[0]?.phone).toBe("+97259226350");
  });

  it("uses email lookup when email present and no phone", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "moha zaqout",
      first_name: "moha",
      last_name: "zaqout",
      email: "mohazaqout@gmail.com",
      shopify_customer_id: "11533125386531",
    });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts"));
    expect(gets[0]?.url).toContain("email=");
    expect(gets[0]?.url).toContain("mohazaqout%40gmail.com");
  });
});

// ---------------------------------------------------------------------------
// Real Shopify customers/create payload round-trip
// Tests that the exact JSON shape Shopify sends produces the correct Zoho body
// ---------------------------------------------------------------------------

// Exact payload from Shopify Admin → Settings → Notifications → Webhooks →
// customers/create → recent deliveries (PII anonymised, structure preserved).
const REAL_SHOPIFY_CUSTOMER_CREATE_PAYLOAD = {
  id: 7886544019747,
  email: "mohazaqout@gmail.com",
  created_at: "2024-09-15T19:53:39+03:00",
  updated_at: "2025-01-31T00:13:51+03:00",
  first_name: "moha",
  last_name: "zaqout",
  orders_count: 0,
  state: "disabled",
  total_spent: "0.00",
  last_order_id: null,
  note: null,
  verified_email: true,
  multipass_identifier: null,
  tax_exempt: false,
  tags: "",
  last_order_name: null,
  currency: "IQD",
  phone: "+97259226350",
  addresses: [],
  accepts_marketing: false,
  accepts_marketing_updated_at: "2024-09-15T19:53:39+03:00",
  marketing_opt_in_level: null,
  tax_exemptions: [],
  email_marketing_consent: null,
  sms_marketing_consent: null,
  admin_graphql_api_id: "gid://shopify/Customer/7886544019747",
  default_address: null,
};

describe("real Shopify customers/create payload round-trip", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.ZOHO_PRICEBOOK_ID;
  });

  it("parses first_name, last_name, and email from the Shopify payload", () => {
    // Simulate the cast the webhook handler does: payload as ShopifyCustomerPayload
    const c = REAL_SHOPIFY_CUSTOMER_CREATE_PAYLOAD as {
      id: number;
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      phone?: string | null;
    };

    // These are the values the handler reads before calling upsertZohoCustomer
    expect(c.first_name).toBe("moha");
    expect(c.last_name).toBe("zaqout");
    expect(c.email).toBe("mohazaqout@gmail.com");
    expect(c.phone).toBe("+97259226350");
  });

  it("resolveCustomerName builds full name from the real payload", async () => {
    const { resolveCustomerName } = await import("./zoho.server.js");
    const c = REAL_SHOPIFY_CUSTOMER_CREATE_PAYLOAD;
    const { name, resolvedBy } = resolveCustomerName({
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      phone: c.phone,
      shopifyCustomerId: c.id,
    });
    expect(name).toBe("moha zaqout");
    expect(resolvedBy).toBe("name");
  });

  it("Zoho create body contains full name, top-level email, and contact_persons from real payload", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer, resolveCustomerName } = await import("./zoho.server.js");

    const c = REAL_SHOPIFY_CUSTOMER_CREATE_PAYLOAD;
    const { name: customerName } = resolveCustomerName({
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      phone: c.phone,
      shopifyCustomerId: c.id,
    });

    // Exact call the webhook handler makes after the fix
    await upsertZohoCustomer({
      customer_name: customerName,
      ...(c.first_name ? { first_name: c.first_name } : {}),
      ...(c.last_name ? { last_name: c.last_name } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
      shopify_customer_id: String(c.id),
      notes: `Shopify ID: ${c.id} | Shop: geepas-iraq.myshopify.com`,
    });

    const post = calls.find((call) => call.method === "POST" && call.url.includes("/contacts"));
    expect(post).toBeDefined();

    expect(post?.body?.contact_name).toBe("moha zaqout");
    expect(post?.body?.email).toBe("mohazaqout@gmail.com");

    const persons = post?.body?.contact_persons as Array<Record<string, unknown>>;
    expect(Array.isArray(persons)).toBe(true);
    expect(persons[0]?.is_primary_contact).toBe(true);
    expect(persons[0]?.first_name).toBe("moha");
    expect(persons[0]?.last_name).toBe("zaqout");
    expect(persons[0]?.email).toBe("mohazaqout@gmail.com");
    expect(persons[0]?.phone).toBe("+97259226350");
  });
});

// ---------------------------------------------------------------------------
// resolveCustomerName
// ---------------------------------------------------------------------------

describe("resolveCustomerName", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("builds displayName from first and last name when both present", async () => {
    const { resolveCustomerName } = await import("./zoho.server.js");
    const r = resolveCustomerName({ firstName: "moha", lastName: "zaqout", email: "x@y.com", phone: null, shopifyCustomerId: 1 });
    expect(r.name).toBe("moha zaqout");
    expect(r.resolvedBy).toBe("name");
  });

  it("uses first name alone when last name is absent", async () => {
    const { resolveCustomerName } = await import("./zoho.server.js");
    const r = resolveCustomerName({ firstName: "moha", lastName: "", email: "x@y.com", phone: null, shopifyCustomerId: 1 });
    expect(r.name).toBe("moha");
    expect(r.resolvedBy).toBe("name");
  });
});

// ---------------------------------------------------------------------------
// buildEnrichBody (update path)
// ---------------------------------------------------------------------------

describe("buildEnrichBody (update path)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.ZOHO_PRICEBOOK_ID;
  });

  it("does NOT send pricebook_id on update (existing contacts already have one)", async () => {
    const { calls } = mockFetch({ existingContactId: "existing-456" });
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Existing",
      phone: "+9647701234567",
      shopify_customer_id: "44444",
      notes: "Shopify ID: 44444",
    });

    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contacts/"));
    expect(put).toBeDefined();
    expect(put?.body?.pricebook_id).toBeUndefined();
    expect(put?.body?.contact_name).toBeUndefined();
    expect(put?.body?.contact_type).toBeUndefined();

    const fields = put?.body?.custom_fields as Array<{ api_name: string; value: unknown }>;
    const byName = Object.fromEntries(fields.map((f) => [f.api_name, f.value]));
    expect(byName["cf_customer_source"]).toBe("Shopify");
    expect(byName["cf_shopify_customer_id"]).toBe("44444");
    expect(byName["cf_back_margin_rebate"]).toBeUndefined();
    expect(byName["cf_front_margin_rebate"]).toBeUndefined();
    expect(byName["cf_category_type"]).toBeUndefined();
    expect(byName["cf_customer_type"]).toBeUndefined();
  });

  it("includes contact_persons with is_primary_contact on update when email is present", async () => {
    const { calls } = mockFetch({ existingContactId: "existing-789" });
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Memo",
      first_name: "Me",
      last_name: "Mo",
      email: "memo@example.com",
      phone: "+972592263704",
      shopify_customer_id: "11533125386531",
    });

    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contacts/"));
    expect(put).toBeDefined();
    const persons = put?.body?.contact_persons as Array<any> | undefined;
    expect(Array.isArray(persons)).toBe(true);
    expect(persons?.[0]?.is_primary_contact).toBe(true);
    expect(persons?.[0]?.email).toBe("memo@example.com");
    expect(persons?.[0]?.first_name).toBe("Me");
    expect(persons?.[0]?.last_name).toBe("Mo");
    expect(persons?.[0]?.phone).toBe("+972592263704");

    // Still no top-level contact_name/pricebook in update
    expect(put?.body?.contact_name).toBeUndefined();
    expect(put?.body?.pricebook_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Lookup order — phone → email → contact_name
// ---------------------------------------------------------------------------

describe("findExistingContact lookup order", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.ZOHO_PRICEBOOK_ID;
  });

  it("searches by phone first", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", phone: "+9647701234567", email: "t@t.com", shopify_customer_id: "55555" });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts") && !c.url.includes("/pricebooks"));
    expect(gets[0]?.url).toContain("phone=");
  });

  it("searches by email when phone is absent", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", email: "t@t.com", shopify_customer_id: "66666" });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts") && !c.url.includes("/pricebooks"));
    expect(gets[0]?.url).toContain("email=");
  });

  it("searches by contact_name when neither phone nor email is present", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Shopify Customer 99999", shopify_customer_id: "99999" });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts") && !c.url.includes("/pricebooks"));
    expect(gets[0]?.url).toContain("contact_name=");
  });

  it("never searches by cf_shopify_customer_id (encrypted — Zoho blocks search)", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", phone: "+9647701234567", shopify_customer_id: "77777" });

    const lookups = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts"));
    expect(lookups.every((c) => !c.url.includes("cf_shopify_customer_id"))).toBe(true);
  });
});
