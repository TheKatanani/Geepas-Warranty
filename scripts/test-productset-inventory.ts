import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("Testing inventory update via productSet mutation...");

  const setMutation = `#graphql
    mutation productSet($synchronous: Boolean!, $input: ProductSetInput!) {
      productSet(synchronous: $synchronous, input: $input) {
        product {
          id
          title
          variants(first: 5) {
            nodes {
              id
              sku
              price
              inventoryQuantity
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

  // Update variant SKU GWD17021 with price 208500
  const input = {
    title: "TEST ZOHO PRODUCT - GWD17021",
    productOptions: [
      {
        name: "Title",
        values: [{ name: "Default Title" }]
      }
    ],
    variants: [
      {
        optionValues: [{ name: "Default Title", optionName: "Title" }],
        sku: "GWD17021",
        price: "208500",
      }
    ]
  };

  try {
    const res: any = await admin.graphql(setMutation, {
      variables: { synchronous: true, input }
    });
    const json: any = await res.json();
    console.log("productSet Response:\n", JSON.stringify(json, null, 2));
  } catch (e: any) {
    console.error("productSet error:", e.message);
  }
}

main().catch(console.error);
