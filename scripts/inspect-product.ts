import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  console.log(`Inspecting product on ${shop}...`);

  const { admin } = await unauthenticated.admin(shop);

  const res = await admin.graphql(`#graphql
    query searchProduct {
      products(first: 5, query: "title:Double Heating Digital Air Fryer") {
        nodes {
          id
          title
          handle
          hasOnlyDefaultVariant
          options {
            id
            name
            position
            optionValues {
              id
              name
            }
          }
          variants(first: 10) {
            nodes {
              id
              title
              price
              sku
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  `);

  const data = await res.json();
  console.log("GraphQL Output:\n", JSON.stringify(data, null, 2));
}

main().catch(console.error);
