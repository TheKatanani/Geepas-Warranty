import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("Testing modern productVariantsBulkUpdate mutation...");

  // Find variant for GWD17021
  const query = `#graphql
    query getVariant {
      productVariants(first: 1, query: "sku:GWD17021") {
        nodes {
          id
          sku
          price
          product {
            id
          }
        }
      }
    }
  `;

  const res: any = await admin.graphql(query);
  const json: any = await res.json();
  const node = json.data?.productVariants?.nodes?.[0];

  if (!node) {
    console.error("Variant GWD17021 not found");
    return;
  }

  console.log("Found Variant:", node);

  const bulkMutation = `#graphql
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          price
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const vInput = {
    productId: node.product.id,
    variants: [
      {
        id: node.id,
        price: "208500"
      }
    ]
  };

  const bRes: any = await admin.graphql(bulkMutation, { variables: vInput });
  const bJson: any = await bRes.json();
  console.log("productVariantsBulkUpdate Response:\n", JSON.stringify(bJson, null, 2));
}

main().catch(console.error);
