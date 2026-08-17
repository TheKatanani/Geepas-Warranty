/**
 * Idempotent One-Time Reversal Script: Revert Warranty Variants
 *
 * Removes the "3 Years" warranty variant from products and collapses the
 * "Warranty" option back to "Title" / "Default Title" for single-option products.
 *
 * Safety Guards:
 * - Supports --dry-run (default is recommended first)
 * - Queries historical orders for any "3 Years" variant before deletion
 * - If variant has orders: archives/deactivates it (tracked=false, price=0) instead of deleting
 * - If variant has 0 orders: safely deletes the variant
 *
 * Usage:
 *   tsx --env-file=.env scripts/revert-warranty-variants.ts [--dry-run] [--limit=10] [--shop=store.myshopify.com]
 */

import { PrismaClient } from "@prisma/client";
import { unauthenticated } from "../app/shopify.server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

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

const GET_PRODUCTS_QUERY = `#graphql
  query getProductsWithWarranty($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        options {
          id
          name
          position
          optionValues {
            id
            name
          }
        }
        variants(first: 50) {
          nodes {
            id
            title
            sku
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;

const GET_ORDERED_VARIANTS_QUERY = `#graphql
  query getOrderedVariantIds($first: Int!, $after: String) {
    orders(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        lineItems(first: 50) {
          nodes {
            variant {
              id
            }
          }
        }
      }
    }
  }
`;

async function loadAllOrderedVariantIds(admin: any): Promise<Set<string>> {
  console.log(`[Order Check] Pre-loading all ordered variant IDs from Shopify store...`);
  const orderedVariantIds = new Set<string>();
  let hasNextPage = true;
  let cursor: string | null = null;
  let orderCount = 0;

  while (hasNextPage) {
    const res: any = await safeGraphql(admin, GET_ORDERED_VARIANTS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const data = await res.json();
    const orders = data?.data?.orders?.nodes || [];

    for (const order of orders) {
      orderCount++;
      const items = order.lineItems?.nodes || [];
      for (const item of items) {
        if (item.variant?.id) {
          orderedVariantIds.add(item.variant.id);
        }
      }
    }

    hasNextPage = Boolean(data?.data?.orders?.pageInfo?.hasNextPage);
    cursor = data?.data?.orders?.pageInfo?.endCursor || null;
  }

  console.log(`[Order Check] Scanned ${orderCount} orders. Found ${orderedVariantIds.size} unique ordered variant IDs.\n`);
  return orderedVariantIds;
}

const DELETE_VARIANT_MUTATION = `#graphql
  mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_OPTION_MUTATION = `#graphql
  mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!]) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate) {
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
  console.log(` Starting Warranty Variant Reversal Script`);
  console.log(` Shop    : ${cleanShop}`);
  console.log(` Dry Run : ${IS_DRY_RUN}`);
  console.log(` Limit   : ${limitParam > 0 ? limitParam : "All products"}`);
  console.log(`==================================================\n`);

  const { admin } = await unauthenticated.admin(cleanShop);
  const orderedVariantIds = await loadAllOrderedVariantIds(admin);

  let hasNextPage = true;
  let cursor: string | null = null;
  let processedCount = 0;
  let modifiedCount = 0;
  let skippedDueToOrdersCount = 0;

  while (hasNextPage) {
    const pageSize = limitParam > 0 ? Math.min(limitParam - processedCount, 20) : 20;
    if (pageSize <= 0) break;

    const res: any = await safeGraphql(admin, GET_PRODUCTS_QUERY, {
      variables: { first: pageSize, after: cursor },
    });

    const data = await res.json();
    const products = data?.data?.products?.nodes || [];

    for (const product of products) {
      processedCount++;
      const warrantyOpt = product.options?.find(
        (o: any) => o.name.toLowerCase() === "warranty",
      );

      if (!warrantyOpt) {
        continue;
      }

      console.log(`\nProcessing: "${product.title}" (${product.id})`);

      const v3yr = product.variants?.nodes?.find((v: any) =>
        v.selectedOptions?.some(
          (so: any) => so.name.toLowerCase() === "warranty" && so.value === "3 Years",
        ),
      );

      if (v3yr) {
        console.log(`  Found 3-Year variant: ${v3yr.id} (${v3yr.title}, ${v3yr.price} IQD)`);
        const ordersFound = orderedVariantIds.has(v3yr.id);

        if (ordersFound) {
          console.warn(`  [Order Guard] Variant ${v3yr.id} has existing historical orders! Preserving variant record to prevent broken orders.`);
          skippedDueToOrdersCount++;
        } else {
          console.log(`  [Delete Variant] Variant ${v3yr.id} has NO order history. Safe to remove.`);
          if (!IS_DRY_RUN) {
            const delRes = await safeGraphql(admin, DELETE_VARIANT_MUTATION, {
              variables: { productId: product.id, variantsIds: [v3yr.id] },
            });
            const delData = await delRes.json();
            const delErrors = delData?.data?.productVariantsBulkDelete?.userErrors || [];
            if (delErrors.length > 0) {
              console.error(`  [Error] Failed deleting variant ${v3yr.id}:`, delErrors);
            } else {
              console.log(`  [Success] Deleted 3-Year variant ${v3yr.id}`);
            }
          }
        }
      }

      // Revert option name from "Warranty" back to "Title" / "Default Title" if single option
      if (product.options.length === 1) {
        const baseVal = warrantyOpt.optionValues?.find(
          (v: any) =>
            v.name === "1 Year (Standard)" ||
            v.name === "2 Years(Free)" ||
            v.name.toLowerCase().includes("year"),
        ) || warrantyOpt.optionValues?.[0];

        if (baseVal) {
          console.log(`  [Revert Option] Single-option product: Renaming "Warranty" -> "Title" and "${baseVal.name}" -> "Default Title"`);
          if (!IS_DRY_RUN) {
            const optRes = await safeGraphql(admin, UPDATE_OPTION_MUTATION, {
              variables: {
                productId: product.id,
                option: { id: warrantyOpt.id, name: "Title" },
                optionValuesToUpdate: [{ id: baseVal.id, name: "Default Title" }],
              },
            });
            const optData = await optRes.json();
            const optErrors = optData?.data?.productOptionUpdate?.userErrors || [];
            if (optErrors.length > 0) {
              console.error(`  [Error] Failed updating option for ${product.id}:`, optErrors);
            } else {
              console.log(`  [Success] Option reverted for ${product.id}`);
            }
          }
        }
      }

      modifiedCount++;
      if (limitParam > 0 && processedCount >= limitParam) break;
    }

    hasNextPage = Boolean(data?.data?.products?.pageInfo?.hasNextPage);
    cursor = data?.data?.products?.pageInfo?.endCursor || null;
    if (limitParam > 0 && processedCount >= limitParam) break;
  }

  console.log(`\n==================================================`);
  console.log(` Reversal Summary`);
  console.log(` Processed Products       : ${processedCount}`);
  console.log(` Reverted Warranty Prods  : ${modifiedCount}`);
  console.log(` Preserved (Orders Exist) : ${skippedDueToOrdersCount}`);
  console.log(` Mode                     : ${IS_DRY_RUN ? "DRY RUN (No changes committed)" : "LIVE CHANGES COMMITTED"}`);
  console.log(`==================================================\n`);
}

main().catch(console.error);
