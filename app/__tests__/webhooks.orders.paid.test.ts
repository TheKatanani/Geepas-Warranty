import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
  unauthenticated: { admin: vi.fn() },
}));

vi.mock("../db.server", () => ({
  default: {
    sMSLog: { findUnique: vi.fn() },
  },
}));

vi.mock("../services/reward.server", () => ({
  issueRewardAndNotify: vi.fn(),
}));

import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { issueRewardAndNotify } from "../services/reward.server";
import { action } from "../routes/webhooks.orders.paid";
import { resolveOrderPhone, saveCustomerPhone } from "../lib/webhooks.orders.paid.server";

const webhookMock = authenticate.webhook as unknown as Mock;
const adminMock = unauthenticated.admin as unknown as Mock;
const findUniqueMock = prisma.sMSLog.findUnique as unknown as Mock;
const issueRewardMock = issueRewardAndNotify as unknown as Mock;

function buildOrder(overrides: Record<string, any> = {}) {
  return {
    id: 1001,
    order_number: 5001,
    subtotal_price: "50000",
    currency: "IQD",
    created_at: "2026-01-01T00:00:00Z",
    phone: undefined,
    shipping_address: undefined,
    billing_address: undefined,
    customer: {
      id: 111,
      first_name: "Ali",
      phone: "07701234567",
      orders_count: 1,
    },
    line_items: [{ title: "Geepas Blender" }],
    ...overrides,
  };
}

function runAction(order: Record<string, any>, shop = "test.myshopify.com") {
  webhookMock.mockResolvedValue({ shop, payload: order, topic: "ORDERS_PAID" });
  return action({
    request: new Request("http://localhost/webhooks/orders/paid", { method: "POST" }),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockResolvedValue({
    admin: {
      graphql: vi.fn().mockResolvedValue({
        json: async () => ({
          data: { customerUpdate: { customer: { id: "x" }, userErrors: [] } },
        }),
      }),
    },
  });
  issueRewardMock.mockResolvedValue({ success: true, discountCode: "CODE", messageId: "m1" });
});

describe("resolveOrderPhone", () => {
  it("returns customer.phone when present", () => {
    expect(
      resolveOrderPhone({
        id: 1,
        customer: { id: 1, phone: "A" },
        phone: "B",
        shipping_address: { phone: "C" },
        billing_address: { phone: "D" },
      } as any),
    ).toBe("A");
  });

  it("falls back to order.phone when customer.phone is missing", () => {
    expect(
      resolveOrderPhone({
        id: 1,
        phone: "B",
        shipping_address: { phone: "C" },
        billing_address: { phone: "D" },
      } as any),
    ).toBe("B");
  });

  it("falls back to shipping_address.phone when customer.phone and order.phone are missing", () => {
    expect(
      resolveOrderPhone({
        id: 1,
        shipping_address: { phone: "C" },
        billing_address: { phone: "D" },
      } as any),
    ).toBe("C");
  });

  it("falls back to billing_address.phone as the last resort", () => {
    expect(resolveOrderPhone({ id: 1, billing_address: { phone: "D" } } as any)).toBe("D");
  });

  it("returns an empty string when no phone field is set anywhere", () => {
    expect(resolveOrderPhone({ id: 1 } as any)).toBe("");
  });

  it("respects priority order: customer.phone wins even when an address phone is also set", () => {
    expect(
      resolveOrderPhone({
        id: 1,
        customer: { id: 1, phone: "CUSTOMER" },
        shipping_address: { phone: "SHIP" },
        billing_address: { phone: "BILL" },
      } as any),
    ).toBe("CUSTOMER");
  });
});

describe("orders/paid voucher branch logic", () => {
  it("first order (no prior SECOND15 in DB) issues SECOND15, not NEXT15 — even at a high subtotal", async () => {
    findUniqueMock.mockResolvedValue(null);
    const order = buildOrder({
      subtotal_price: "250000", // above the NEXT15 threshold, but irrelevant on a first order
      customer: { id: 111, first_name: "Ali", phone: "07701234567", orders_count: 1 },
    });

    const res = await runAction(order);

    expect(res.status).toBe(200);
    expect(issueRewardMock).toHaveBeenCalledTimes(1);
    expect(issueRewardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rewardType: "SECOND15",
        dedupeKey: "second15:gid://shopify/Customer/111",
      }),
    );
  });

  it("repeat customer (prior SECOND15 in DB) with subtotal >= 100000 issues NEXT15, not SECOND15", async () => {
    findUniqueMock.mockResolvedValue({ id: "sms-1", dedupeKey: "second15:gid://shopify/Customer/222" });
    const order = buildOrder({
      id: 2002,
      subtotal_price: "150000",
      customer: { id: 222, first_name: "Sara", phone: "07701234567", orders_count: 3 },
    });

    const res = await runAction(order);

    expect(res.status).toBe(200);
    expect(issueRewardMock).toHaveBeenCalledTimes(1);
    expect(issueRewardMock).toHaveBeenCalledWith(
      expect.objectContaining({ rewardType: "NEXT15", dedupeKey: "next15:2002" }),
    );
    expect(issueRewardMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ rewardType: "SECOND15" }),
    );
  });

  it("repeat customer with subtotal < 100000 issues no voucher at all", async () => {
    findUniqueMock.mockResolvedValue({ id: "sms-1" });
    const order = buildOrder({
      subtotal_price: "50000",
      customer: { id: 333, first_name: "Omar", phone: "07701234567", orders_count: 4 },
    });

    const res = await runAction(order);

    expect(res.status).toBe(200);
    expect(issueRewardMock).not.toHaveBeenCalled();
  });

  it("no phone resolvable anywhere on the order skips all vouchers but still returns 200", async () => {
    const order = buildOrder({
      phone: undefined,
      shipping_address: undefined,
      billing_address: undefined,
      customer: { id: 444, first_name: "NoPhone", phone: undefined, orders_count: 1 },
    });

    const res = await runAction(order);

    expect(res.status).toBe(200);
    expect(issueRewardMock).not.toHaveBeenCalled();
    // The no-phone guard returns before the DB is ever consulted.
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("decides from DB state, not the stale payload ordersCount — ordersCount=0 with prior SECOND15 in DB still takes the NEXT15 path", async () => {
    findUniqueMock.mockResolvedValue({ id: "sms-1", dedupeKey: "second15:gid://shopify/Customer/555" });
    const order = buildOrder({
      id: 3003,
      subtotal_price: "200000",
      customer: { id: 555, first_name: "Lagged", phone: "07701234567", orders_count: 0 },
    });

    const res = await runAction(order);

    expect(res.status).toBe(200);
    expect(issueRewardMock).toHaveBeenCalledWith(
      expect.objectContaining({ rewardType: "NEXT15" }),
    );
    expect(issueRewardMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ rewardType: "SECOND15" }),
    );
  });
});

describe("saveCustomerPhone", () => {
  it("does not throw when Shopify returns userErrors (e.g. phone already taken)", async () => {
    const graphqlMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          customerUpdate: {
            customer: null,
            userErrors: [{ field: "phone", message: "Phone has already been taken" }],
          },
        },
      }),
    });
    adminMock.mockResolvedValue({ admin: { graphql: graphqlMock } });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      saveCustomerPhone("test.myshopify.com", "gid://shopify/Customer/1", "+9647701234567"),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls customerUpdate with the customer id and normalized phone on success", async () => {
    const graphqlMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: { customerUpdate: { customer: { id: "gid://shopify/Customer/1" }, userErrors: [] } },
      }),
    });
    adminMock.mockResolvedValue({ admin: { graphql: graphqlMock } });

    await saveCustomerPhone("test.myshopify.com", "gid://shopify/Customer/1", "+9647701234567");

    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining("customerUpdate"),
      { variables: { input: { id: "gid://shopify/Customer/1", phone: "+9647701234567" } } },
    );
  });
});
