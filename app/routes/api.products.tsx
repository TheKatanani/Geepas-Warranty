import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

/**
 * GET /api/products?shop=store.myshopify.com&search=air+fryer
 *
 * Public endpoint - searches Shopify catalog products by title.
 * Returns product title, id, and first variant SKU.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const search = url.searchParams.get("search") || "";

  if (!shop) {
    return json({ error: "shop query parameter is required" }, { status: 400 });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    const queryFilter = search ? `title:*${search}*` : "";

    const response = await admin.graphql(
      `#graphql
      query searchProducts($query: String!, $first: Int!) {
        products(first: $first, query: $query, sortKey: TITLE) {
          edges {
            node {
              id
              title
              status
              variants(first: 1) {
                edges {
                  node {
                    sku
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          query: queryFilter,
          first: 25,
        },
      }
    );

    const data = await response.json();
    const edges = data?.data?.products?.edges || [];

    const products = edges
      .filter((e: any) => e.node.status === "ACTIVE")
      .map((e: any) => ({
        id: e.node.id,
        title: e.node.title,
        sku: e.node.variants?.edges?.[0]?.node?.sku || null,
      }));

    return json({ products });
  } catch (error: any) {
    console.error("[api.products] Error:", error);
    return json(
      {
        error: "Failed to fetch products.",
        debug: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
};
