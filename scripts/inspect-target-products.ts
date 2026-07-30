import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const res: any = await admin.graphql(`#graphql
    query inspectProducts {
      p1: products(first: 5, query: "title:'Car Sunshade Window Mesh'") {
        nodes {
          id
          title
          productType
          tags
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
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
      p2: products(first: 5, query: "title:'5 Pcs Bamboo Kitchen Tools Set'") {
        nodes {
          id
          title
          productType
          tags
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
  console.log("Products Inspection Data:\n", JSON.stringify(data?.data, null, 2));
}

main().catch(console.error);
