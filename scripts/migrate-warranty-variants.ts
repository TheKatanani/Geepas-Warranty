/**
 * Idempotent One-Time & Maintenance Script: Migrate Warranty Variants
 *
 * Adds or updates the "Warranty" option on active products.
 *   - "1 Year (Standard)" -> Base variant (tracks stock, keeps base price)
 *   - "3 Years"           -> Extended variant (price = Math.round(basePrice * 1.15), tracked: false)
 *
 * Usage:
 *   pnpm migrate-variants [--dry-run] [--limit=5] [--shop=store.myshopify.com] [--token=shpat_...]
 */

import { PrismaClient } from "@prisma/client";
import { unauthenticated } from "../app/shopify.server";
import {
  BASE_WARRANTY_VALUE,
  EXTENDED_WARRANTY_VALUE,
  WARRANTY_OPTION_NAME,
  calculateWarrantyPrice,
  shouldUpdateWarrantyPrice,
} from "../app/utils/warranty-pricing.server";
import { isElectricalProduct } from "../app/utils/electrical-filter.server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

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

const PRODUCT_OPTION_UPDATE_MUTATION = `#graphql
  mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!], $optionValuesToAdd: [OptionValueCreateInput!]) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate, optionValuesToAdd: $optionValuesToAdd) {
      userErrors {
        field
        message
      }
      product {
        id
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

const PRODUCT_OPTION_CREATE_MUTATION = `#graphql
  mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options) {
      userErrors {
        field
        message
      }
      product {
        id
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

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `#graphql
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
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
  let variants = product.variants?.nodes || [];
  let options = product.options || [];

  if (!isElectricalProduct(product)) {
    console.log(`[Skip Non-Electrical] "${product.title}" is not an electrical appliance.`);
    return;
  }

  if (variants.length === 0) {
    console.log(`[Skip] Product "${product.title}" (${product.id}) has no variants.`);
    return;
  }

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

  let warrantyOption = options.find(
    (o) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase(),
  );

  if (warrantyOption) {
    const legacyVal = warrantyOption.optionValues?.find(
      (val) => val.name === "1 Year (Standard)" || (val.name.includes("1 Year") && !val.name.includes("3")),
    );
    if (legacyVal) {
      console.log(`[Option Rename] "${product.title}" — Renaming option value "${legacyVal.name}" -> "${BASE_WARRANTY_VALUE}"`);
      if (!IS_DRY_RUN) {
        const updateRes = await admin.graphql(PRODUCT_OPTION_UPDATE_MUTATION, {
          variables: {
            productId: product.id,
            option: { id: warrantyOption.id, name: WARRANTY_OPTION_NAME },
            optionValuesToUpdate: [{ id: legacyVal.id, name: BASE_WARRANTY_VALUE }],
          },
        });
        const updateData = await updateRes.json();
        const updatedProd = updateData?.data?.productOptionUpdate?.product;
        if (updatedProd) {
          options = updatedProd.options || options;
          variants = updatedProd.variants?.nodes || variants;
          warrantyOption = options.find((o) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase());
        }
      }
    }
  }

  if (!warrantyOption) {
    const titleOption = options.find((o) => o.name.toLowerCase() === "title");

    if (titleOption) {
      console.log(`[Option Update] "${product.title}" — Updating option "Title" -> "Warranty" and adding "3 Years"`);
      if (IS_DRY_RUN) {
        console.log(`  [Dry Run] Would call productOptionUpdate for "${product.title}"`);
        return;
      }

      const defaultVal = titleOption.optionValues?.find((v) => v.name === "Default Title") || titleOption.optionValues?.[0];

      const updateRes = await admin.graphql(PRODUCT_OPTION_UPDATE_MUTATION, {
        variables: {
          productId: product.id,
          option: { id: titleOption.id, name: WARRANTY_OPTION_NAME },
          optionValuesToUpdate: defaultVal ? [{ id: defaultVal.id, name: BASE_WARRANTY_VALUE }] : [],
          optionValuesToAdd: [{ name: EXTENDED_WARRANTY_VALUE }],
        },
      });

      const updateData = await updateRes.json();
      const updateErrors = updateData?.data?.productOptionUpdate?.userErrors || [];
      if (updateErrors.length > 0) {
        console.error(`  [Error] productOptionUpdate failed for "${product.title}":`, updateErrors);
        return;
      }

      const updatedProd = updateData?.data?.productOptionUpdate?.product;
      if (updatedProd) {
        options = updatedProd.options || options;
        variants = updatedProd.variants?.nodes || variants;
        warrantyOption = options.find((o) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase());
      }
    } else {
      console.log(`[Option Create] "${product.title}" — Creating Warranty option for multi-option product`);
      if (IS_DRY_RUN) {
        console.log(`  [Dry Run] Would call productOptionCreate for "${product.title}"`);
        return;
      }

      const createRes = await admin.graphql(PRODUCT_OPTION_CREATE_MUTATION, {
        variables: {
          productId: product.id,
          options: [
            {
              name: WARRANTY_OPTION_NAME,
              values: [{ name: BASE_WARRANTY_VALUE }, { name: EXTENDED_WARRANTY_VALUE }],
            },
          ],
        },
      });

      const createData = await createRes.json();
      const createErrors = createData?.data?.productOptionsCreate?.userErrors || [];
      if (createErrors.length > 0) {
        console.error(`  [Error] productOptionsCreate failed for "${product.title}":`, createErrors);
        return;
      }

      const updatedProd = createData?.data?.productOptionsCreate?.product;
      if (updatedProd) {
        options = updatedProd.options || options;
        variants = updatedProd.variants?.nodes || variants;
        warrantyOption = options.find((o) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase());
      }
    }
  }

  // Check 3-Year variant(s)
  const existing3YrVariants = variants.filter((v) =>
    v.selectedOptions.some(
      (opt) => opt.name === WARRANTY_OPTION_NAME && opt.value === EXTENDED_WARRANTY_VALUE,
    ),
  );

  if (existing3YrVariants.length > 0) {
    for (const v3yr of existing3YrVariants) {
      const needsUpdate = shouldUpdateWarrantyPrice(basePrice, v3yr.price);
      if (!needsUpdate) {
        console.log(`[OK] "${product.title}" — 3-Year variant ${v3yr.id} synced at ${v3yr.price} IQD`);
        continue;
      }

      console.log(`[Update Price] "${product.title}" — 3-Year variant price from ${v3yr.price} to ${expected3YrPrice} IQD`);
      if (IS_DRY_RUN) continue;

      const res = await admin.graphql(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
        variables: {
          productId: product.id,
          variants: [
            {
              id: v3yr.id,
              price: expected3YrPrice.toString(),
              inventoryItem: { tracked: false },
            },
          ],
        },
      });

      const data = await res.json();
      const errors = data?.data?.productVariantsBulkUpdate?.userErrors || [];
      if (errors.length > 0) {
        console.error(`  [Error] productVariantsBulkUpdate failed for "${product.title}":`, errors);
      } else {
        console.log(`  [Success] Updated 3-Year variant for "${product.title}" to ${expected3YrPrice} IQD`);
      }
    }
  } else if (warrantyOption) {
    const threeYearValObj = warrantyOption.optionValues?.find(
      (val) => val.name === EXTENDED_WARRANTY_VALUE,
    );

    if (threeYearValObj) {
      console.log(`[Create Variant] "${product.title}" — Creating 3-Year variant at ${expected3YrPrice} IQD`);
      if (IS_DRY_RUN) return;

      const createVarRes = await admin.graphql(PRODUCT_VARIANTS_BULK_CREATE_MUTATION, {
        variables: {
          productId: product.id,
          variants: [
            {
              optionValues: [
                { optionId: warrantyOption.id, id: threeYearValObj.id },
              ],
              price: expected3YrPrice.toString(),
              inventoryItem: { tracked: false },
            },
          ],
        },
      });

      const createVarData = await createVarRes.json();
      const createVarErrors = createVarData?.data?.productVariantsBulkCreate?.userErrors || [];
      if (createVarErrors.length > 0) {
        console.error(`  [Error] productVariantsBulkCreate failed for "${product.title}":`, createVarErrors);
      } else {
        console.log(`  [Success] Created 3-Year variant for "${product.title}" at ${expected3YrPrice} IQD`);
      }
    }
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

  const cleanShop = shopParam.replace(/^https?:\/\//, "").replace(/\/$/, "");

  console.log(`\n==================================================`);
  console.log(` Starting Warranty Variant Migration / Sync`);
  console.log(` Shop    : ${cleanShop}`);
  console.log(` Dry Run : ${IS_DRY_RUN}`);
  console.log(` Limit   : ${limitParam > 0 ? limitParam : "All products"}`);
  console.log(`==================================================\n`);

  let admin: any;

  const tokenArg = args.find((a) => a.startsWith("--token="));
  const cliToken = tokenArg ? tokenArg.split("=")[1] : (process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "");

  let dbToken = "";
  if (!cliToken) {
    try {
      const dbSession = await prisma.session.findFirst({
        where: { shop: { contains: cleanShop } },
        orderBy: { expires: "desc" },
      });
      if (dbSession?.accessToken) {
        dbToken = dbSession.accessToken;
      }
    } catch (err: any) {
      console.warn(`[Auth Warning] DB query failed (${err.message}).`);
    }
  }

  const unauth = await unauthenticated.admin(cleanShop);
  admin = unauth.admin;

  let hasNextPage = true;
  let cursor: string | null = null;
  let processedCount = 0;

  while (hasNextPage) {
    const fetchSize = limitParam > 0 && limitParam - processedCount < 20 ? limitParam - processedCount : 20;

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
