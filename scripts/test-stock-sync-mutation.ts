import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("Testing Shopify Inventory Stock Update Mutation...");

  // Step 1: Find a variant with SKU GWD17021
  const query = `#graphql
    query getVariantBySku {
      productVariants(first: 5, query: "sku:GWD17021") {
        nodes {
          id
          sku
          inventoryQuantity
          inventoryItem {
            id
            tracked
          }
          product {
            id
            title
          }
        }
      }
    }
  `;

  const res: any = await admin.graphql(query);
  const json: any = await res.json();
  console.log("Variant Query Output:\n", JSON.stringify(json, null, 2));

  const variant = json.data?.productVariants?.nodes?.[0];
  if (!variant) {
    console.error("Variant GWD17021 not found");
    return;
  }

  const inventoryItemId = variant.inventoryItem?.id;
  console.log(`InventoryItem ID: ${inventoryItemId}`);

  // Test updating variant via productSet / inventorySetQuantities / productVariantUpdate
  const updateVariantMutation = `#graphql
    mutation productVariantUpdate($input: ProductVariantInput!) {
      productVariantUpdate(input: $input) {
        productVariant {
          id
          sku
          inventoryQuantity
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const vInput = {
    id: variant.id,
    inventoryItem: {
      tracked: true
    }
  };

  const vRes: any = await admin.graphql(updateVariantMutation, { variables: { input: vInput } });
  const vJson: any = await vRes.json();
  console.log("Variant Update Output:\n", JSON.stringify(vJson, null, 2));
}

main().catch(console.error);
