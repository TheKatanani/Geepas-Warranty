import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn() },
}));

import { unauthenticated } from "../shopify.server";
import { loader } from "../routes/api.products";

const adminMock = unauthenticated.admin as unknown as Mock;

function graphqlResponse(data: any) {
  return { json: async () => ({ data }) };
}

function runLoader(search: string) {
  const url = `https://example.com/api/products?shop=test.myshopify.com&search=${encodeURIComponent(search)}`;
  return loader({ request: new Request(url) } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/products", () => {
  it("does not search when the term is shorter than 3 characters", async () => {
    const graphql = vi.fn();
    adminMock.mockResolvedValue({ admin: { graphql } });

    const res = await runLoader("ga");
    const body = (await res.json()) as any;

    expect(graphql).not.toHaveBeenCalled();
    expect(body).toEqual({ results: [], source: "sku" });
  });

  it("matches at the variant level and returns SKU/title/image fields", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      graphqlResponse({
        productVariants: {
          edges: [
            {
              node: {
                id: "gid://shopify/ProductVariant/1",
                sku: "GA-1234",
                title: "Default Title",
                image: { url: "https://cdn/variant.jpg" },
                product: {
                  id: "gid://shopify/Product/9",
                  title: "Geepas Air Fryer",
                  status: "ACTIVE",
                  featuredImage: { url: "https://cdn/product.jpg" },
                },
              },
            },
            {
              // Inactive product — must be filtered out
              node: {
                id: "gid://shopify/ProductVariant/2",
                sku: "GA-1235",
                title: "Default Title",
                image: null,
                product: {
                  id: "gid://shopify/Product/10",
                  title: "Discontinued Item",
                  status: "DRAFT",
                  featuredImage: null,
                },
              },
            },
          ],
        },
      }),
    );
    adminMock.mockResolvedValue({ admin: { graphql } });

    const res = await runLoader("GA-1234");
    const body = (await res.json()) as any;

    expect(body.source).toBe("sku");
    expect(body.results).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/1",
        productId: "gid://shopify/Product/9",
        sku: "GA-1234",
        productTitle: "Geepas Air Fryer",
        variantTitle: null,
        imageUrl: "https://cdn/variant.jpg",
      },
    ]);

    // Searches both the raw and dash-stripped forms in one query.
    const [, options] = graphql.mock.calls[0];
    expect(options.variables.query).toContain("sku:GA-1234*");
    expect(options.variables.query).toContain("sku:GA1234*");
  });

  it("falls back to a name search when the SKU search returns zero results", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(graphqlResponse({ productVariants: { edges: [] } }))
      .mockResolvedValueOnce(
        graphqlResponse({
          products: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Product/9",
                  title: "Geepas Air Fryer",
                  status: "ACTIVE",
                  featuredImage: { url: "https://cdn/product.jpg" },
                  variants: {
                    edges: [
                      {
                        node: {
                          id: "gid://shopify/ProductVariant/1",
                          sku: "GA-1234",
                          title: "Default Title",
                          image: null,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        }),
      );
    adminMock.mockResolvedValue({ admin: { graphql } });

    const res = await runLoader("air fryer");
    const body = (await res.json()) as any;

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(body.source).toBe("name");
    expect(body.results).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/1",
        productId: "gid://shopify/Product/9",
        sku: "GA-1234",
        productTitle: "Geepas Air Fryer",
        variantTitle: null,
        imageUrl: "https://cdn/product.jpg",
      },
    ]);
  });
});
