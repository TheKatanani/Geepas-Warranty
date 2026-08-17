import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = process.env.SHOP || process.env.SHOP_CUSTOM_DOMAIN || "ae53cd-2.myshopify.com";
  const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");

  console.log(`\n==================================================`);
  console.log(` Cart Transform Activation & Verification`);
  console.log(` Shop : ${cleanShop}`);
  console.log(`==================================================\n`);

  const { admin } = await unauthenticated.admin(cleanShop);

  // 1. Fetch available shopify functions
  console.log("1. Checking deployed Shopify Functions...");
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
  console.log("Shopify Functions found:", JSON.stringify(functionsData, null, 2));

  // 2. Fetch active cart transforms
  console.log("\n2. Checking active Cart Transforms...");
  const transformsRes: any = await admin.graphql(`
    query {
      cartTransforms(first: 10) {
        nodes {
          id
          functionId
          blockOnFailure
        }
      }
    }
  `);

  const transformsData = await transformsRes.json();
  console.log("Active Cart Transforms:", JSON.stringify(transformsData, null, 2));

  const fn = functionsData.data?.shopifyFunctions?.nodes?.find(
    (f: any) => f.title?.toLowerCase().includes("warranty") || f.apiType?.includes("cart_transform")
  );

  if (!fn) {
    console.warn("⚠️ No warranty cart_transform function found on Shopify yet. Ensure the app version with the extension is released.");
    return;
  }

  console.log(`\nFound warranty function: "${fn.title}" (ID: ${fn.id})`);
  const activeTransform = transformsData.data?.cartTransforms?.nodes?.find(
    (t: any) => t.functionId === fn.id
  );

  if (activeTransform) {
    console.log(`\n✅ Cart Transform is ALREADY ACTIVE on the store (ID: ${activeTransform.id}).`);
  } else {
    console.log("\nActivating Cart Transform on store via mutation...");
    const activateRes: any = await admin.graphql(
      `
        mutation cartTransformCreate($functionId: String!) {
          cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
            cartTransform {
              id
              functionId
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: { functionId: fn.id },
      }
    );
    const activateData = await activateRes.json();
    console.log("Cart Transform activation result:", JSON.stringify(activateData, null, 2));
  }
}

main().catch(console.error);
