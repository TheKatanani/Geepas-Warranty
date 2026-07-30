import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const res: any = await admin.graphql(`#graphql
    query inspectMissing {
      products(first: 5, query: "title:Combination Lock OR title:Cable Ties OR title:PVC Insulation Tape") {
        nodes {
          id
          title
          status
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
            }
          }
        }
      }
    }
  `);

  const data = await res.json();
  console.log("Missing Products Data:\n", JSON.stringify(data, null, 2));
}

main().catch(console.error);
