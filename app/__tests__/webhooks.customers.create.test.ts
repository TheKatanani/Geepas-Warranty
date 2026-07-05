import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock authenticate.webhook to return a realistic customers/create payload
vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(async () => ({
      shop: "test.myshopify.com",
      topic: "customers/create",
      payload: {
        id: 1234567890,
        email: "mohazaqout@gmail.com",
        first_name: "moha",
        last_name: "zaqout",
        phone: "+972 59-226-3505",
        default_address: null,
      },
    })),
  },
}));

// Partially mock zoho.server to capture the upsert payload while keeping real name resolver
const upsertSpy = vi.fn(async (_payload: any) => ({ success: true, alreadyExists: false, zohoContactId: "z-1" }));
vi.mock("../services/zoho.server", async () => {
  const actual = await vi.importActual<any>("../services/zoho.server");
  return {
    ...actual,
    upsertZohoCustomer: upsertSpy,
  };
});

describe("webhooks.customers.create", () => {
  beforeEach(() => {
    vi.resetModules();
    upsertSpy.mockClear();
  });

  it("parses email from top-level payload and passes it to Zoho, with full displayName", async () => {
    const { action } = await import("../routes/webhooks.customers.create.js");

    const res = await action({ request: new Request("https://example.com/webhooks/customers/create", { method: "POST" }) } as any);
    expect(res.status).toBe(200);

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const arg = upsertSpy.mock.calls[0][0];

    expect(arg.email).toBe("mohazaqout@gmail.com");
    expect(arg.first_name).toBe("moha");
    expect(arg.last_name).toBe("zaqout");
    expect(arg.customer_name).toBe("moha zaqout");
  });
});
