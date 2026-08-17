import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  // Query product variant 55477194653987
  const res = await admin.graphql(`
    query {
      productVariant(id: "gid://shopify/ProductVariant/55477194653987") {
        id
        title
        price
        availableForSale
        product {
          id
          title
          status
        }
      }
    }
  `);

  const json = await res.json();
  console.log("Variant Details:", JSON.stringify(json, null, 2));
}

main().catch(console.error);
