/**
 * Script: Tag Eligible Products for Warranty
 *
 * Applies the `warranty-eligible` tag to electrical products so the storefront UI
 * and Cart Transform Function can dynamically offer and price warranty options.
 *
 * Usage:
 *   tsx --env-file=.env scripts/tag-eligible-products.ts [--dry-run] [--limit=50] [--shop=store.myshopify.com]
 */

import { unauthenticated } from "../app/shopify.server";
import { isElectricalProduct } from "../app/utils/electrical-filter.server";

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");

let limitParam = 0;
const limitArg = args.find((a) => a.startsWith("--limit="));
if (limitArg) {
  limitParam = parseInt(limitArg.split("=")[1], 10) || 0;
}

let shopParam = process.env.SHOP || process.env.SHOP_CUSTOM_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "ae53cd-2.myshopify.com";
const shopArg = args.find((a) => a.startsWith("--shop="));
if (shopArg) {
  shopParam = shopArg.split("=")[1];
}

const ELIGIBLE_TAG = "warranty-eligible";

const GET_PRODUCTS_QUERY = `#graphql
  query getProductsForTagging($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:ACTIVE") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        productType
        tags
      }
    }
  }
`;

const TAGS_ADD_MUTATION = `#graphql
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

async function safeGraphql(admin: any, query: string, options: { variables?: any } = {}, maxRetries = 4): Promise<any> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await admin.graphql(query, options);
      return res;
    } catch (err: any) {
      attempt++;
      console.warn(`  [Network Warning] GraphQL request failed (attempt ${attempt}/${maxRetries}): ${err?.message || err}. Retrying in ${attempt * 1500}ms...`);
      if (attempt >= maxRetries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

async function main() {
  if (!shopParam) {
    console.error("Error: Shop domain not provided. Specify --shop=your-store.myshopify.com or set SHOP_CUSTOM_DOMAIN env var.");
    process.exit(1);
  }

  const cleanShop = shopParam.replace(/^https?:\/\//, "").replace(/\/$/, "");

  console.log(`\n==================================================`);
  console.log(` Starting Product Warranty Eligibility Tagging`);
  console.log(` Shop     : ${cleanShop}`);
  console.log(` Tag      : ${ELIGIBLE_TAG}`);
  console.log(` Dry Run  : ${IS_DRY_RUN}`);
  console.log(` Limit    : ${limitParam > 0 ? limitParam : "All products"}`);
  console.log(`==================================================\n`);

  const { admin } = await unauthenticated.admin(cleanShop);

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalChecked = 0;
  let taggedCount = 0;
  let alreadyTaggedCount = 0;
  let skippedCount = 0;

  while (hasNextPage) {
    const pageSize = limitParam > 0 ? Math.min(limitParam - totalChecked, 50) : 50;
    if (pageSize <= 0) break;

    const res: any = await safeGraphql(admin, GET_PRODUCTS_QUERY, {
      variables: { first: pageSize, after: cursor },
    });

    const data = await res.json();
    const products = data?.data?.products?.nodes || [];

    for (const product of products) {
      totalChecked++;

      const isElectrical = isElectricalProduct(product);
      if (!isElectrical) {
        skippedCount++;
        continue;
      }

      const currentTags = Array.isArray(product.tags) ? product.tags : (product.tags || "").split(",").map((t: string) => t.trim());
      if (currentTags.includes(ELIGIBLE_TAG)) {
        alreadyTaggedCount++;
        continue;
      }

      console.log(`[Tagging] "${product.title}" (${product.id})`);
      if (!IS_DRY_RUN) {
        const tagRes = await safeGraphql(admin, TAGS_ADD_MUTATION, {
          variables: {
            id: product.id,
            tags: [ELIGIBLE_TAG],
          },
        });
        const tagData = await tagRes.json();
        const tagErrors = tagData?.data?.tagsAdd?.userErrors || [];
        if (tagErrors.length > 0) {
          console.error(`  [Error] Failed adding tag to ${product.id}:`, tagErrors);
        } else {
          taggedCount++;
        }
      } else {
        taggedCount++;
      }

      if (limitParam > 0 && totalChecked >= limitParam) break;
    }

    hasNextPage = Boolean(data?.data?.products?.pageInfo?.hasNextPage);
    cursor = data?.data?.products?.pageInfo?.endCursor || null;
    if (limitParam > 0 && totalChecked >= limitParam) break;
  }

  console.log(`\n==================================================`);
  console.log(` Tagging Summary`);
  console.log(` Total Evaluated       : ${totalChecked}`);
  console.log(` Newly Tagged          : ${taggedCount}`);
  console.log(` Already Tagged        : ${alreadyTaggedCount}`);
  console.log(` Skipped (Non-Electr.) : ${skippedCount}`);
  console.log(` Mode                  : ${IS_DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`==================================================\n`);
}

main().catch(console.error);
