/**
 * Idempotent One-Time & Maintenance Script: Migrate Warranty Variants
 *
 * Adds or updates the "Warranty" option on active products.
 *   - "1 Year (Standard)" -> Base variant (tracks stock, keeps base price)
 *   - "3 Years"           -> Extended variant (price = Math.round(basePrice * 1.15), tracked: false)
 *
 * Usage:
 *   pnpm migrate-variants [--dry-run] [--limit=5] [--shop=store.myshopify.com]
 *   (or: pnpm tsx --env-file=.env scripts/migrate-warranty-variants.ts --dry-run)
 */

import { unauthenticated } from "../app/shopify.server";
import {
  BASE_WARRANTY_VALUE,
  EXTENDED_WARRANTY_VALUE,
  WARRANTY_OPTION_NAME,
  calculateWarrantyPrice,
  shouldUpdateWarrantyPrice,
} from "../app/utils/warranty-pricing.server";

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");

let limitParam = 0;
const limitArg = args.find((a) => a.startsWith("--limit="));
if (limitArg) {
  limitParam = parseInt(limitArg.split("=")[1], 10) || 0;
}

let shopParam = process.env.SHOP_CUSTOM_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "";
const shopArg = args.find((a) => a.startsWith("--shop="));
if (shopArg) {
  shopParam = shopArg.split("=")[1];
}

// ---------------------------------------------------------------------------
// GraphQL Queries & Mutations
// ---------------------------------------------------------------------------

const GET_PRODUCTS_QUERY = `#graphql
  query getProductsForWarrantyMigration($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:ACTIVE") {
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
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            selectedOptions {
              name
              value
            }
            inventoryItem {
              tracked
            }
          }
        }
      }
    }
  }`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
      }
      userErrors {
        field
        message
      }
    }
  }`;

// ---------------------------------------------------------------------------
// Helper: Process single product
// ---------------------------------------------------------------------------

interface ProductNode {
  id: string;
  title: string;
  options: Array<{
    id: string;
    name: string;
    position: number;
    optionValues: Array<{ id: string; name: string }>;
  }>;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      price: string;
      selectedOptions: Array<{ name: string; value: string }>;
      inventoryItem: { tracked: boolean } | null;
    }>;
  };
}

async function processProduct(admin: any, product: ProductNode) {
  const variants = product.variants?.nodes || [];
  if (variants.length === 0) {
    console.log(`[Skip] Product "${product.title}" (${product.id}) has no variants.`);
    return;
  }

  // Find 1-Year (base) variant and 3-Year variant
  const baseVariant =
    variants.find((v) =>
      v.selectedOptions.some(
        (opt) => opt.name === WARRANTY_OPTION_NAME && opt.value === BASE_WARRANTY_VALUE,
      ),
    ) || variants[0];

  const basePrice = parseFloat(baseVariant.price || "0");
  if (basePrice <= 0) {
    console.log(`[Skip] Product "${product.title}" has zero/invalid base price: ${baseVariant.price}`);
    return;
  }

  const expected3YrPrice = calculateWarrantyPrice(basePrice);

  const existing3YrVariant = variants.find((v) =>
    v.selectedOptions.some(
      (opt) => opt.name === WARRANTY_OPTION_NAME && opt.value === EXTENDED_WARRANTY_VALUE,
    ),
  );

  if (existing3YrVariant) {
    const needsUpdate = shouldUpdateWarrantyPrice(basePrice, existing3YrVariant.price);

    if (!needsUpdate) {
      console.log(
        `[OK] "${product.title}" — 3-Year variant ${existing3YrVariant.id} already synced at ${existing3YrVariant.price} IQD`,
      );
      return;
    }

    console.log(
      `[Update Needed] "${product.title}" — Updating 3-Year variant from ${existing3YrVariant.price} to ${expected3YrPrice} IQD (Base: ${basePrice})`,
    );

    if (IS_DRY_RUN) {
      console.log(`  [Dry Run] Would call productVariantsBulkUpdate for ${existing3YrVariant.id}`);
      return;
    }

    const res = await admin.graphql(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
      variables: {
        productId: product.id,
        variants: [
          {
            id: existing3YrVariant.id,
            price: expected3YrPrice.toString(),
            inventoryItem: { tracked: false },
          },
        ],
      },
    });

    const data = await res.json();
    const errors = data?.data?.productVariantsBulkUpdate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`  [Error] Failed to update 3-Year variant for "${product.title}":`, errors);
    } else {
      console.log(`  [Success] Updated 3-Year variant for "${product.title}" to ${expected3YrPrice} IQD`);
    }
  } else {
    // If 3-Year variant doesn't exist, log info
    console.log(
      `[Notice] Product "${product.title}" base price is ${basePrice} IQD. Target 3-Year price: ${expected3YrPrice} IQD.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------

async function main() {
  if (!shopParam) {
    console.error("Error: Shop domain not provided. Specify --shop=your-store.myshopify.com or set SHOP_CUSTOM_DOMAIN env var.");
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(` Starting Warranty Variant Migration / Sync`);
  console.log(` Shop    : ${shopParam}`);
  console.log(` Dry Run : ${IS_DRY_RUN}`);
  console.log(` Limit   : ${limitParam > 0 ? limitParam : "All products"}`);
  console.log(`==================================================\n`);

  const { admin } = await unauthenticated.admin(shopParam);

  let hasNextPage = true;
  let cursor: string | null = null;
  let processedCount = 0;

  while (hasNextPage) {
    const fetchSize = limitParam > 0 && limitParam - processedCount < 50 ? limitParam - processedCount : 50;

    const response: any = await admin.graphql(GET_PRODUCTS_QUERY, {
      variables: {
        first: fetchSize,
        after: cursor,
      },
    });

    const json = await response.json();
    const productsData = json?.data?.products;
    const nodes: ProductNode[] = productsData?.nodes || [];

    for (const product of nodes) {
      await processProduct(admin, product);
      processedCount++;
      if (limitParam > 0 && processedCount >= limitParam) {
        hasNextPage = false;
        break;
      }
    }

    hasNextPage = hasNextPage && Boolean(productsData?.pageInfo?.hasNextPage);
    cursor = productsData?.pageInfo?.endCursor || null;
  }

  console.log(`\nCompleted processing ${processedCount} product(s).`);
}

main().catch((err) => {
  console.error("Fatal Migration Error:", err);
  process.exit(1);
});
