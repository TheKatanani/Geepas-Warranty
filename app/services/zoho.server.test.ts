/**
 * Tests for zoho.server.ts body builders.
 *
 * We intercept global fetch to capture the exact JSON POSTed to Zoho so we
 * can assert field presence/absence without exporting private functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared fetch mock factory
// ---------------------------------------------------------------------------

type CapturedCall = { url: string; method: string; body: Record<string, unknown> | null };

function mockFetch(opts: {
  /** contacts to return on GET /contacts lookups (empty = no existing contact) */
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
    process.env.ZOHO_PRICEBOOK_ID = "pb-999";
  });

  it("includes pricebook_id from ZOHO_PRICEBOOK_ID env var", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({ customer_name: "Test Customer", shopify_customer_id: "11111" });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post?.body?.pricebook_id).toBe("pb-999");
  });

  it("includes contact_name, contact_type, and four custom fields on create", async () => {
    const { calls } = mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Sameer",
      phone: "+9647701234567",
      shopify_customer_id: "22222",
      notes: "Shopify ID: 22222 | Shop: test.myshopify.com",
    });

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/contacts"));
    expect(post?.body?.contact_name).toBe("Sameer");
    expect(post?.body?.contact_type).toBe("customer");

    const fields = post?.body?.custom_fields as Array<{ api_name: string; value: unknown }>;
    const apiNames = fields.map((f) => f.api_name);
    expect(apiNames).toContain("cf_customer_source");
    expect(apiNames).toContain("cf_shopify_customer_id");
    expect(apiNames).toContain("cf_category_type");
    expect(apiNames).toContain("cf_customer_type");
    // Numeric fields removed after error 108008
    expect(apiNames).not.toContain("cf_credit_limit");
    expect(apiNames).not.toContain("cf_back_margin_rebate");
    expect(apiNames).not.toContain("cf_front_margin_rebate");
  });

  it("returns an error (not a throw) when ZOHO_PRICEBOOK_ID is not set", async () => {
    delete process.env.ZOHO_PRICEBOOK_ID;
    mockFetch({});
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    const result = await upsertZohoCustomer({
      customer_name: "No Pricebook",
      shopify_customer_id: "33333",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ZOHO_PRICEBOOK_ID/);
  });
});

// ---------------------------------------------------------------------------
// buildEnrichBody tests (update / existing contact path)
// ---------------------------------------------------------------------------

describe("buildEnrichBody (update path)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.ZOHO_PRICEBOOK_ID = "pb-999";
  });

  it("does NOT include pricebook_id, contact_name, or contact_type on update", async () => {
    const { calls } = mockFetch({ existingContactId: "existing-contact-456" });
    const { upsertZohoCustomer } = await import("./zoho.server.js");

    await upsertZohoCustomer({
      customer_name: "Existing Customer",
      shopify_customer_id: "44444",
      notes: "Shopify ID: 44444",
    });

    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contacts/"));
    expect(put).toBeDefined();
    expect(put?.body?.pricebook_id).toBeUndefined();
    expect(put?.body?.contact_name).toBeUndefined();
    expect(put?.body?.contact_type).toBeUndefined();

    const fields = put?.body?.custom_fields as Array<{ api_name: string }>;
    const apiNames = fields.map((f) => f.api_name);
    expect(apiNames).toContain("cf_customer_source");
    expect(apiNames).toContain("cf_shopify_customer_id");
    // Category/type are create-only
    expect(apiNames).not.toContain("cf_category_type");
    expect(apiNames).not.toContain("cf_customer_type");
  });
});
