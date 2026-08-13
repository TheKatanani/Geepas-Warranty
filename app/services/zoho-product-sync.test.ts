import { describe, it, expect, vi } from "vitest";
import { diffZohoAndShopify, createShopifyProductFromZoho } from "./zoho-product-sync.server.js";
import { parseZohoCsv, ZohoItem } from "./zoho.server.js";

describe("Zoho Product Sync Service", () => {
  const sampleZohoItems: ZohoItem[] = [
    { item_id: "1", name: "FAN-2", sku: "GF21160", rate: 120000, stock_on_hand: 8, brand: "GEEPAS", category_name: "LHH", location_name: "ZYN Warehouse" },
    { item_id: "2", name: "IRON-1", sku: "GSI24015", rate: 39000, stock_on_hand: 0, brand: "GEEPAS", category_name: "LHH", location_name: "ERB Warehouse" },
    { item_id: "3", name: "IRON-4", sku: "GSI24025", rate: 49000, stock_on_hand: 354, brand: "GEEPAS", category_name: "ELC", location_name: "ZYN Warehouse" },
  ];

  it("diffZohoAndShopify identifies items missing in Shopify", () => {
    const shopifyVariants = [
      { sku: "GF21160" }, // FAN-2 exists in Shopify
    ];

    const diff = diffZohoAndShopify(sampleZohoItems, shopifyVariants);

    expect(diff.totalZohoItems).toBe(3);
    expect(diff.totalShopifyVariants).toBe(1);
    expect(diff.matchedCount).toBe(1);
    expect(diff.missingItems).toHaveLength(2);
    expect(diff.missingItems.map(i => i.sku)).toEqual(["GSI24015", "GSI24025"]);
  });

  it("diffZohoAndShopify filters strictly by warehouse name (e.g. ZYN)", () => {
    const shopifyVariants = [
      { sku: "GF21160" }, // FAN-2 exists in Shopify
    ];

    const diff = diffZohoAndShopify(sampleZohoItems, shopifyVariants, { warehouseFilter: "ZYN" });

    expect(diff.totalZohoItems).toBe(3);
    expect(diff.filteredZohoItems).toBe(2); // Only FAN-2 and IRON-4 belong to ZYN
    expect(diff.matchedCount).toBe(1); // FAN-2 is matched
    expect(diff.missingItems).toHaveLength(1);
    expect(diff.missingItems[0].sku).toBe("GSI24025");
  });

  it("parseZohoCsv correctly parses raw Zoho Item.csv export with location", () => {
    const csvContent = `Item ID,Item Name,SKU,UPC,Selling Price,Stock On Hand,Brand,Category Name,Status,Location Name
4516918000000119477,FAN-2,GF21160,6294015534863,IQD 120000,8,GEEPAS,LHH,Active,ZYN
4516918000000119490,IRON-1,GSI24015,6294015517927,IQD 39000,0,GEEPAS,LHH,Active,ERB`;

    const parsed = parseZohoCsv(csvContent);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      item_id: "4516918000000119477",
      name: "FAN-2",
      sku: "GF21160",
      upc: "6294015534863",
      ean: undefined,
      description: undefined,
      rate: 120000,
      stock_on_hand: 8,
      brand: "GEEPAS",
      category_name: "LHH",
      status: "Active",
      unit: undefined,
      location_name: "ZYN",
      warehouse_name: "ZYN",
    });
  });

  it("createShopifyProductFromZoho calls GraphQL Admin API with correct payload", async () => {
    const mockAdmin = {
      graphql: vi.fn().mockResolvedValue({
        json: async () => ({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/9999",
                title: "IRON-4",
                handle: "iron-4",
                status: "ACTIVE",
                variants: { edges: [{ node: { id: "v1", sku: "GSI24025", price: "49000" } }] },
              },
              userErrors: [],
            },
          },
        }),
      }),
    };

    const item: ZohoItem = {
      item_id: "3",
      name: "IRON-4",
      sku: "GSI24025",
      rate: 49000,
      stock_on_hand: 354,
      brand: "GEEPAS",
      category_name: "ELC",
      description: "Ceramic Steam Iron 3000W",
      location_name: "ZYN",
    };

    const res = await createShopifyProductFromZoho(mockAdmin, item, { status: "ACTIVE" });

    expect(res.success).toBe(true);
    expect(res.shopifyProductId).toBe("gid://shopify/Product/9999");
    expect(mockAdmin.graphql).toHaveBeenCalledTimes(1);

    const callArgs = mockAdmin.graphql.mock.calls[0];
    const variables = callArgs[1].variables;
    expect(variables.input.title).toBe("IRON-4");
    expect(variables.input.vendor).toBe("GEEPAS");
    expect(variables.input.status).toBe("ACTIVE");
    expect(variables.input.variants[0].sku).toBe("GSI24025");
    expect(variables.input.variants[0].price).toBe("49000");
  });
});
