import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("Testing modern Shopify productSet / productCreate mutation...");

  // Option A: productSet mutation (supported in 2024-04+)
  const setMutation = `#graphql
    mutation productSet($synchronous: Boolean!, $input: ProductSetInput!) {
      productSet(synchronous: $synchronous, input: $input) {
        product {
          id
          title
          handle
          status
          variants(first: 5) {
            nodes {
              id
              sku
              price
              barcode
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

  const input = {
    title: "TEST ZOHO PRODUCT - GWD17021",
    vendor: "GEEPAS",
    productType: "Water Dispenser",
    descriptionHtml: "<p>Test Zoho Product Sync Creation</p>",
    status: "DRAFT",
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
        barcode: "6294015519426"
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
    console.log("productSet error:", e.message);
  }
}

main().catch(console.error);
