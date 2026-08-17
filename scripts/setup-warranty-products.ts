/**
 * Script: Setup Standalone Warranty Products & Metafields
 *
 * Creates or updates the hidden standalone warranty products carrying metafields:
 *   - warranty.duration_years (integer)
 *   - warranty.price_multiplier (decimal, e.g. 1.15)
 *   - warranty.applies_to_tag (string, default "warranty-eligible")
 *   - warranty.active (boolean, default true)
 *
 * Ensures:
 *   - inventoryItem.tracked = false (no phantom Zoho SKUs or inventory tracking)
 *   - productType = "Warranty Service"
 *
 * Usage:
 *   tsx --env-file=.env scripts/setup-warranty-products.ts [--shop=store.myshopify.com]
 */

import { unauthenticated } from "../app/shopify.server";

const args = process.argv.slice(2);
let shopParam = process.env.SHOP || process.env.SHOP_CUSTOM_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "ae53cd-2.myshopify.com";
const shopArg = args.find((a) => a.startsWith("--shop="));
if (shopArg) {
  shopParam = shopArg.split("=")[1];
}

interface WarrantyOfferingConfig {
  title: string;
  handle: string;
  durationYears: number;
  priceMultiplier: number;
  appliesToTag: string;
  active: boolean;
}

const DEFAULT_OFFERINGS: WarrantyOfferingConfig[] = [
  {
    title: "Extended Warranty (3 Years)",
    handle: "extended-warranty-3-years",
    durationYears: 3,
    priceMultiplier: 1.15, // 15% warranty fee
    appliesToTag: "warranty-eligible",
    active: true,
  },
];

const FIND_PRODUCT_BY_HANDLE_QUERY = `#graphql
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      status
      metafields(first: 10, namespace: "warranty") {
        nodes {
          id
          key
          value
          type
        }
      }
      variants(first: 5) {
        nodes {
          id
          title
          price
          inventoryItem {
            tracked
          }
        }
      }
    }
  }
`;

const CREATE_PRODUCT_MUTATION = `#graphql
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        variants(first: 5) {
          nodes {
            id
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `#graphql
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_VARIANT_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        inventoryItem {
          tracked
        }
      }
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

async function syncOffering(admin: any, config: WarrantyOfferingConfig) {
  console.log(`\n--------------------------------------------------`);
  console.log(`Processing Offering: "${config.title}" (${config.handle})`);
  console.log(`Duration: ${config.durationYears} Years | Multiplier: ${config.priceMultiplier} | Active: ${config.active}`);

  const findRes: any = await safeGraphql(admin, FIND_PRODUCT_BY_HANDLE_QUERY, {
    variables: { handle: config.handle },
  });
  const findData = await findRes.json();
  let product = findData?.data?.productByHandle;

  const metafields = [
    {
      namespace: "warranty",
      key: "duration_years",
      value: config.durationYears.toString(),
      type: "number_integer",
    },
    {
      namespace: "warranty",
      key: "price_multiplier",
      value: config.priceMultiplier.toString(),
      type: "number_decimal",
    },
    {
      namespace: "warranty",
      key: "applies_to_tag",
      value: config.appliesToTag,
      type: "single_line_text_field",
    },
    {
      namespace: "warranty",
      key: "active",
      value: config.active.toString(),
      type: "boolean",
    },
  ];

  if (!product) {
    console.log(`  Product not found. Creating standalone hidden product...`);
    const createRes: any = await safeGraphql(admin, CREATE_PRODUCT_MUTATION, {
      variables: {
        input: {
          title: config.title,
          handle: config.handle,
          productType: "Warranty Service",
          vendor: "Geepas Iraq",
          status: "ACTIVE",
          tags: ["warranty-service", "hidden-service"],
          metafields,
        },
      },
    });

    const createData = await createRes.json();
    const createErrors = createData?.data?.productCreate?.userErrors || [];
    if (createErrors.length > 0) {
      console.error(`  [Error] Failed to create product:`, createErrors);
      return;
    }

    product = createData?.data?.productCreate?.product;
    console.log(`  [Success] Created product ${product.id}`);
  } else {
    console.log(`  Product exists (${product.id}). Updating metafields and attributes...`);
    const updateRes: any = await safeGraphql(admin, UPDATE_PRODUCT_MUTATION, {
      variables: {
        input: {
          id: product.id,
          title: config.title,
          productType: "Warranty Service",
          metafields,
        },
      },
    });

    const updateData = await updateRes.json();
    const updateErrors = updateData?.data?.productUpdate?.userErrors || [];
    if (updateErrors.length > 0) {
      console.error(`  [Error] Failed to update product:`, updateErrors);
    } else {
      console.log(`  [Success] Updated metafields for ${product.id}`);
    }
  }

  // Ensure variant has inventory tracking disabled
  const variant = product.variants?.nodes?.[0];
  if (variant) {
    console.log(`  Ensuring inventory tracking is OFF for variant ${variant.id}...`);
    const varRes: any = await safeGraphql(admin, UPDATE_VARIANT_MUTATION, {
      variables: {
        productId: product.id,
        variants: [
          {
            id: variant.id,
            price: "0",
            inventoryItem: {
              tracked: false,
            },
          },
        ],
      },
    });
    const varData = await varRes.json();
    const varErrors = varData?.data?.productVariantsBulkUpdate?.userErrors || [];
    if (varErrors.length > 0) {
      console.warn(`  [Warning] Variant update errors:`, varErrors);
    } else {
      console.log(`  [Success] Variant ${variant.id} configured (price: 0, tracked: false)`);
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
  console.log(` Setup Standalone Warranty Products & Metafields`);
  console.log(` Shop : ${cleanShop}`);
  console.log(`==================================================\n`);

  const { admin } = await unauthenticated.admin(cleanShop);

  for (const offering of DEFAULT_OFFERINGS) {
    await syncOffering(admin, offering);
  }

  console.log(`\n==================================================`);
  console.log(` Setup completed successfully.`);
  console.log(`==================================================\n`);
}

main().catch(console.error);
