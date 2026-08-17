import { unauthenticated } from "../app/shopify.server";
import prisma from "../app/db.server";

const SHOP = process.env.SHOP || process.env.SHOP_CUSTOM_DOMAIN || "ae53cd-2.myshopify.com";
const cleanShop = SHOP.replace(/^https?:\/\//, "").replace(/\/$/, "");

const WARRANTY_PRODUCT_HANDLE = "extended-warranty-3-years";
const WARRANTY_BASE_PRICE = "500000"; // 500,000 IQD base ceiling

async function main() {
  console.log(`\n==================================================`);
  console.log(` Activate Warranty Product Discount`);
  console.log(` Shop : ${cleanShop}`);
  console.log(`==================================================\n`);

  const { admin } = await unauthenticated.admin(cleanShop);

  // 1. Update Warranty Product Variant Base Price to 500,000 IQD
  console.log("1. Setting warranty variant price to 500,000 IQD...");
  const prodRes: any = await admin.graphql(`
    query getWarrantyProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
        title
        variants(first: 5) {
          nodes {
            id
            price
            inventoryItem {
              tracked
            }
          }
        }
      }
    }
  `, {
    variables: { handle: WARRANTY_PRODUCT_HANDLE },
  });

  const prodData = await prodRes.json();
  const warrantyProduct = prodData?.data?.productByHandle;

  if (!warrantyProduct) {
    console.error(`❌ Product "${WARRANTY_PRODUCT_HANDLE}" not found in Shopify.`);
    return;
  }

  const variant = warrantyProduct.variants?.nodes?.[0];
  if (variant) {
    console.log(`   Found variant: ${variant.id} (Current Price: ${variant.price})`);
    const updateRes: any = await admin.graphql(`
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            price
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        productId: warrantyProduct.id,
        variants: [
          {
            id: variant.id,
            price: WARRANTY_BASE_PRICE,
            inventoryItem: {
              tracked: false,
            },
          },
        ],
      },
    });

    const updateData = await updateRes.json();
    const updateErrors = updateData?.data?.productVariantsBulkUpdate?.userErrors || [];
    if (updateErrors.length > 0) {
      console.error("   ❌ Failed updating variant price:", updateErrors);
    } else {
      console.log(`   ✅ Variant price set to ${WARRANTY_BASE_PRICE} IQD (Untracked).`);
    }
  }

  // 2. Fetch deployed Shopify Functions
  console.log("\n2. Checking deployed Shopify Functions...");
  const functionsRes: any = await admin.graphql(`
    query {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
          app {
            title
          }
        }
      }
    }
  `);

  const functionsData = await functionsRes.json();
  const functions = functionsData?.data?.shopifyFunctions?.nodes || [];
  console.log("   Functions found:", functions.map((f: any) => `${f.title} (${f.apiType}, ID: ${f.id})`));

  const discountFn = functions.find(
    (f: any) =>
      f.title?.toLowerCase().includes("warranty") &&
      (f.apiType?.includes("product_discount") || f.title?.toLowerCase().includes("discount"))
  );

  if (!discountFn) {
    console.warn("⚠️ No warranty product_discount function found on Shopify yet. Please deploy first (`pnpm shopify app deploy`).");
    return;
  }

  console.log(`   ✅ Found Discount Function: "${discountFn.title}" (ID: ${discountFn.id})`);

  // 3. Check existing automatic discounts and remove previous ones if needed
  console.log("\n3. Checking active automatic app discounts...");
  const discountsRes: any = await admin.graphql(`
    query {
      discountNodes(first: 20) {
        nodes {
          id
          discount {
            ... on DiscountAutomaticApp {
              title
              status
              appDiscountType {
                functionId
                title
              }
            }
          }
        }
      }
    }
  `);

  const discountsData = await discountsRes.json();
  const existingDiscounts = discountsData?.data?.discountNodes?.nodes || [];
  let alreadyActive = false;

  for (const node of existingDiscounts) {
    const disc = node.discount;
    if (disc?.appDiscountType?.functionId === discountFn.id) {
      console.log(`   ✅ Automatic discount is ALREADY ACTIVE (ID: ${node.id}, Status: ${disc.status})`);
      alreadyActive = true;
      break;
    }
  }

  if (!alreadyActive) {
    console.log("\n4. Creating Automatic App Discount on Shopify...");
    const createRes: any = await admin.graphql(`
      mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            discountId
            title
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        automaticAppDiscount: {
          title: "Extended Warranty (3 Years) 15% Dynamic Pricing",
          functionId: discountFn.id,
          startsAt: new Date().toISOString(),
        },
      },
    });

    const createData = await createRes.json();
    const errors = createData?.data?.discountAutomaticAppCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error("   ❌ Failed creating discount:", errors);
    } else {
      const created = createData?.data?.discountAutomaticAppCreate?.automaticAppDiscount;
      console.log(`   🎉 Successfully created Automatic App Discount! ID: ${created?.discountId}, Status: ${created?.status}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(` Activation Completed`);
  console.log(`==================================================\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
