import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
  unauthenticated: { admin: vi.fn() },
}));

import { authenticate } from "../shopify.server";

const webhookMock = authenticate.webhook as unknown as Mock;
const graphqlSpy = vi.fn();

function runAction(payload: Record<string, any>, topic = "PRODUCTS_UPDATE", shop = "test.myshopify.com") {
  webhookMock.mockResolvedValue({
    shop,
    payload,
    topic,
    admin: { graphql: graphqlSpy },
  });

  return import("../routes/webhooks.products.update.js").then(({ action }) =>
    action({
      request: new Request("https://example.com/webhooks/products/update", { method: "POST" }),
    } as any),
  );
}

describe("webhooks.products.update", () => {
  beforeEach(() => {
    vi.resetModules();
    graphqlSpy.mockReset();
    graphqlSpy.mockResolvedValue({
      json: async () => ({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: "gid://shopify/ProductVariant/202", price: "57500" }],
            userErrors: [],
          },
        },
      }),
    });
  });

  it("updates the 3-Year variant price when base variant price changes", async () => {
    const payload = {
      id: 1001,
      title: "Geepas Blender",
      variants: [
        {
          id: 201,
          title: "1 Year (Standard)",
          price: "50000.00",
          option1: "1 Year (Standard)",
        },
        {
          id: 202,
          title: "3 Years",
          price: "51750.00", // Old 3-Year price from base 45000
          option1: "3 Years",
        },
      ],
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);

    // 50,000 * 1.15 = 57,500
    expect(graphqlSpy).toHaveBeenCalledTimes(1);
    const [mutation, { variables }] = graphqlSpy.mock.calls[0];
    expect(mutation).toContain("productVariantsBulkUpdate");
    expect(variables.productId).toBe("gid://shopify/Product/1001");
    expect(variables.variants).toEqual([
      {
        id: "gid://shopify/ProductVariant/202",
        price: "57500",
        inventoryItem: { tracked: false },
      },
    ]);
  });

  it("prevents infinite webhook loops when 3-Year variant price is already synced", async () => {
    const payload = {
      id: 1001,
      title: "Geepas Blender",
      variants: [
        {
          id: 201,
          title: "1 Year (Standard)",
          price: "45000.00",
          option1: "1 Year (Standard)",
        },
        {
          id: 202,
          title: "3 Years",
          price: "51750.00", // Already 45000 * 1.15 = 51750
          option1: "3 Years",
        },
      ],
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);

    // Loop guard should prevent GraphQL call
    expect(graphqlSpy).not.toHaveBeenCalled();
  });

  it("handles multi-option products correctly", async () => {
    const payload = {
      id: 1002,
      title: "Geepas Air Fryer",
      variants: [
        {
          id: 301,
          title: "Red / 1 Year (Standard)",
          price: "100000.00",
          option1: "Red",
          option2: "1 Year (Standard)",
        },
        {
          id: 302,
          title: "Red / 3 Years",
          price: "100000.00", // Needs sync to 115000
          option1: "Red",
          option2: "3 Years",
        },
      ],
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);

    // 100,000 * 1.15 = 115,000
    expect(graphqlSpy).toHaveBeenCalledTimes(1);
    const [, { variables }] = graphqlSpy.mock.calls[0];
    expect(variables.variants[0]).toEqual({
      id: "gid://shopify/ProductVariant/302",
      price: "115000",
      inventoryItem: { tracked: false },
    });
  });

  it("skips products that do not have a 3-Year Extended Warranty variant", async () => {
    const payload = {
      id: 1003,
      title: "Standard Knife Set",
      variants: [
        {
          id: 401,
          title: "Default Title",
          price: "15000.00",
          option1: "Default Title",
        },
      ],
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);
    expect(graphqlSpy).not.toHaveBeenCalled();
  });
});
