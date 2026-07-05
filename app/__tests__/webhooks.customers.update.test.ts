import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
  unauthenticated: { admin: vi.fn() },
}));

vi.mock("../db.server", () => ({
  default: {
    warrantyRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
    sMSLog: { create: vi.fn() },
    customerReward: { upsert: vi.fn() },
  },
}));

vi.mock("../services/infobip.server", () => ({
  sendWarrantySms: vi.fn(),
}));

const upsertSpy = vi.fn(async (_payload: any) => ({ success: true, alreadyExists: false, zohoContactId: "z-1" }));
vi.mock("../services/zoho.server", async () => {
  const actual = await vi.importActual<any>("../services/zoho.server");
  return {
    ...actual,
    upsertZohoCustomer: upsertSpy,
  };
});

const fetchCustomerSpy = vi.fn();
vi.mock("../lib/fetch-customer.server", () => ({
  fetchCustomerFromAdmin: fetchCustomerSpy,
}));

import { authenticate } from "../shopify.server";

const webhookMock = authenticate.webhook as unknown as Mock;

function runAction(payload: Record<string, any>, shop = "test.myshopify.com") {
  webhookMock.mockResolvedValue({ shop, payload, topic: "customers/update" });
  return import("../routes/webhooks.customers.update.js").then(({ action }) =>
    action({
      request: new Request("https://example.com/webhooks/customers/update", { method: "POST" }),
    } as any),
  );
}

describe("webhooks.customers.update", () => {
  beforeEach(() => {
    vi.resetModules();
    upsertSpy.mockClear();
    fetchCustomerSpy.mockReset();
  });

  it("fetches the full customer via Admin GraphQL and passes the full name + email to Zoho, even when the webhook payload only has id + first_name + phone", async () => {
    fetchCustomerSpy.mockResolvedValue({
      firstName: "moha",
      lastName: "zaqout",
      email: "mohazaqout@gmail.com",
      phone: "+972 59-226-3505",
      defaultAddressName: null,
    });

    const res = await runAction({
      id: 1234567890,
      first_name: "moha",
      phone: "+972 59-226-3505",
      tags: "",
      default_address: null,
    });

    expect(res.status).toBe(200);
    expect(fetchCustomerSpy).toHaveBeenCalledWith("test.myshopify.com", 1234567890);

    // Zoho sync runs fire-and-forget; flush microtasks so the .then() logging fires.
    await new Promise((r) => setTimeout(r, 0));

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const arg = upsertSpy.mock.calls[0][0];
    expect(arg.email).toBe("mohazaqout@gmail.com");
    expect(arg.first_name).toBe("moha");
    expect(arg.last_name).toBe("zaqout");
    expect(arg.customer_name).toBe("moha zaqout");
  });

  it("falls back to the redacted webhook payload fields when the Admin GraphQL fetch fails", async () => {
    fetchCustomerSpy.mockRejectedValue(new Error("boom"));

    const res = await runAction({
      id: 1234567890,
      first_name: "moha",
      phone: "+972 59-226-3505",
      tags: "",
      default_address: null,
    });

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 0));

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const arg = upsertSpy.mock.calls[0][0];
    expect(arg.email).toBeUndefined();
    expect(arg.last_name).toBeUndefined();
    expect(arg.first_name).toBe("moha");
    expect(arg.customer_name).toBe("moha");
  });
});
