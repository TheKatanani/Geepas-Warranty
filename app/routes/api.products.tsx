import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import {
  escapeQueryTerm,
  skuSearchTerms,
  variantDisplayTitle,
  translateArabicQuery,
} from "../utils/sku-search.server";

const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 10;

interface ProductSearchResult {
  variantId: string;
  productId: string;
  sku: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
}

const VARIANT_SEARCH_QUERY = `#graphql
  query searchVariantsBySku($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      edges {
        node {
          id
          sku
          title
          image { url }
          product {
            id
            title
            status
            featuredImage { url }
          }
        }
      }
    }
  }`;

const PRODUCT_NAME_SEARCH_QUERY = `#graphql
  query searchProductsByTitle($query: String!, $first: Int!) {
    products(first: $first, query: $query, sortKey: TITLE) {
      edges {
        node {
          id
          title
          status
          featuredImage { url }
          variants(first: 1) {
            edges {
              node {
                id
                sku
                title
                image { url }
              }
            }
          }
        }
      }
    }
  }`;

async function searchVariantsBySku(
  admin: any,
  term: string,
): Promise<ProductSearchResult[]> {
  const terms = skuSearchTerms(term);
  const queryFilter = terms
    .map((t) => `sku:${escapeQueryTerm(t)}*`)
    .join(" OR ");

  const response = await admin.graphql(VARIANT_SEARCH_QUERY, {
    variables: { query: queryFilter, first: RESULT_LIMIT * 2 },
  });
  const data = await response.json();
  const edges = data?.data?.productVariants?.edges || [];

  const seen = new Set<string>();
  const results: ProductSearchResult[] = [];
  for (const edge of edges) {
    const node = edge.node;
    if (node.product?.status !== "ACTIVE") continue;
    if (
      node.product?.title?.toLowerCase().includes("extended warranty") ||
      node.sku === "WAR-3Y" ||
      node.title?.toLowerCase().includes("3 year")
    ) {
      continue;
    }
    if (seen.has(node.id)) continue;
    seen.add(node.id);

    results.push({
      variantId: node.id,
      productId: node.product.id,
      sku: node.sku || null,
      productTitle: node.product.title,
      variantTitle: variantDisplayTitle(node.title),
      imageUrl: node.image?.url || node.product.featuredImage?.url || null,
    });

    if (results.length >= RESULT_LIMIT) break;
  }
  return results;
}

async function searchProductsByName(
  admin: any,
  term: string,
): Promise<ProductSearchResult[]> {
  const queryFilter = `title:*${escapeQueryTerm(term)}*`;

  const response = await admin.graphql(PRODUCT_NAME_SEARCH_QUERY, {
    variables: { query: queryFilter, first: RESULT_LIMIT },
  });
  const data = await response.json();
  const edges = data?.data?.products?.edges || [];

  return edges
    .filter(
      (e: any) =>
        e.node.status === "ACTIVE" &&
        !e.node.title?.toLowerCase().includes("extended warranty"),
    )
    .map((e: any): ProductSearchResult => {
      const variant = e.node.variants?.edges?.[0]?.node;
      return {
        variantId: variant?.id || e.node.id,
        productId: e.node.id,
        sku: variant?.sku || null,
        productTitle: e.node.title,
        variantTitle: variantDisplayTitle(variant?.title),
        imageUrl: variant?.image?.url || e.node.featuredImage?.url || null,
      };
    });
}

/**
 * GET /api/products?shop=store.myshopify.com&search=GA-1234
 *
 * Public endpoint — searches the Shopify catalog by SKU (variant-level,
 * prefix match). Falls back to a product-title search when no SKU matches
 * are found, so customers who type the product name out of habit still get
 * results ("Did you mean" on the frontend).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const search = (url.searchParams.get("search") || "").trim();

  if (!shop) {
    return json({ error: "shop query parameter is required" }, { status: 400 });
  }

  if (search.length < MIN_QUERY_LENGTH) {
    return json({ results: [], source: "sku" as const });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    const skuResults = await searchVariantsBySku(admin, search);
    if (skuResults.length > 0) {
      return json({ results: skuResults, source: "sku" as const });
    }

    const nameResults = await searchProductsByName(admin, search);
    if (nameResults.length > 0) {
      return json({ results: nameResults, source: "name" as const });
    }

    // If query is Arabic or no results found, try translated query
    const isArabic = /[\u0600-\u06FF]/.test(search);
    const translated = isArabic ? translateArabicQuery(search) : "";
    if (translated) {
      const translatedResults = await searchProductsByName(admin, translated);
      if (translatedResults.length > 0) {
        return json({ results: translatedResults, source: "name" as const });
      }
    }

    return json({ results: [], source: "sku" as const });
  } catch (error: any) {
    console.error("[api.products] Error:", error);
    return json(
      {
        error: "Failed to fetch products.",
        debug: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
};
