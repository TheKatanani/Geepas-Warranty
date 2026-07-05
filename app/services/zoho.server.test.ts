/**
 * Tests for zoho.server.ts body builders and lookup order.
 *
 * We intercept global fetch to capture the exact JSON sent to Zoho so we can
 * assert field presence/absence without exporting private functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared fetch mock factory
// ---------------------------------------------------------------------------

type CapturedCall = { url: string; method: string; body: Record<string, unknown> | null };

function mockFetch(opts: {
  /** contact_id to return on GET /contacts lookups (undefined = no existing contact) */
  existingContactId?: string;
}): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url, method, body });

      // OAuth token endpoint
      if ((url as string).includes("accounts.zoho")) {
        return new Response(
          JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
          { status: 200 },
        );
      }

      // GET /contacts — lookup
      if (method === "GET" && (url as string).includes("/contacts")) {
        const contacts = opts.existingContactId
          ? [{ contact_id: opts.existingContactId }]
          : [];
        return new Response(JSON.stringify({ contacts }), { status: 200 });
      }

      // POST /contacts — create
      if (method === "POST" && (url as string).includes("/contacts")) {
        return new Response(
          JSON.stringify({ code: 0, contact: { contact_id: "new-contact-123" } }),
          { status: 200 },
        );
      }

      // PUT /contacts/{id} — enrich/update
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
// buildCreateBody tests
// ---------------------------------------------------------------------------

describe("buildCreateBody", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("sends all seven required custom fields on create", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Sameer",
      phone: "+9647701234567",
      shopify_customer_id: "22222",
    });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post?.body?.contact_name).toBe("Sameer");
    expect(post?.body?.contact_type).toBe("customer");

    const fields = post?.body?.custom_fields as Array<{ api_name: string; value: unknown }>;
    const byName = Object.fromEntries(fields.map((f) => [f.api_name, f.value]));

    expect(byName["cf_price_list"]).toBe("ONLINE RSP");
    expect(byName["cf_back_margin_rebate"]).toBe(0);
    expect(byName["cf_front_margin_rebate"]).toBe(0);
    expect(byName["cf_category_type"]).toBe("MIX");
    expect(byName["cf_customer_type"]).toBe("Cash");
    expect(byName["cf_customer_source"]).toBe("Shopify");
    expect(byName["cf_shopify_customer_id"]).toBe("22222");
  });

  it("does NOT send pricebook_id as a top-level field", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", shopify_customer_id: "11111" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post?.body?.pricebook_id).toBeUndefined();
  });

  it("does NOT send cf_credit_limit (Zoho auto-applies its default of 2 000 000)", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test", shopify_customer_id: "11111" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    const fields = post?.body?.custom_fields as Array<{ api_name: string }>;
    expect(fields.map((f) => f.api_name)).not.toContain("cf_credit_limit");
  });
});

// ---------------------------------------------------------------------------
// buildEnrichBody tests (update / existing contact path)
// ---------------------------------------------------------------------------

describe("buildEnrichBody (update path)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("sends only cf_customer_source and cf_shopify_customer_id on update", async () => {
    const { calls } = mockFetch({ existingContactId: "existing-456" });
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Existing Customer",
      phone: "+9647701234567",
      shopify_customer_id: "44444",
      notes: "Shopify ID: 44444",
    });

    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contacts/"));
    expect(put).toBeDefined();

    // Must NOT overwrite fields the native integration owns
    expect(put?.body?.pricebook_id).toBeUndefined();
    expect(put?.body?.contact_name).toBeUndefined();
    expect(put?.body?.contact_type).toBeUndefined();

    const fields = put?.body?.custom_fields as Array<{ api_name: string; value: unknown }>;
    const byName = Object.fromEntries(fields.map((f) => [f.api_name, f.value]));
    expect(byName["cf_customer_source"]).toBe("Shopify");
    expect(byName["cf_shopify_customer_id"]).toBe("44444");

    // Create-only fields must not appear in enrich body
    expect(byName["cf_price_list"]).toBeUndefined();
    expect(byName["cf_back_margin_rebate"]).toBeUndefined();
    expect(byName["cf_front_margin_rebate"]).toBeUndefined();
    expect(byName["cf_category_type"]).toBeUndefined();
    expect(byName["cf_customer_type"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Lookup order tests — phone → email → contact_name
// ---------------------------------------------------------------------------

describe("findExistingContact lookup order", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("searches by phone first", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Test",
      phone: "+9647701234567",
      email: "test@example.com",
      shopify_customer_id: "55555",
    });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts"));
    // First lookup must be by phone
    expect(gets[0]?.url).toContain("phone=");
  });

  it("searches by email second when phone is absent", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Test",
      email: "test@example.com",
      shopify_customer_id: "66666",
    });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts"));
    expect(gets[0]?.url).toContain("email=");
  });

  it("searches by contact_name when neither phone nor email is present", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Shopify Customer 99999",
      shopify_customer_id: "99999",
    });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts"));
    expect(gets[0]?.url).toContain("contact_name=");
  });

  it("does NOT search by cf_shopify_customer_id (encrypted field — Zoho blocks search)", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Test",
      phone: "+9647701234567",
      shopify_customer_id: "77777",
    });

    const gets = calls.filter((c) => c.method === "GET" && c.url.includes("/contacts"));
    const urls = gets.map((c) => c.url);
    expect(urls.every((u) => !u.includes("cf_shopify_customer_id"))).toBe(true);
  });
});
