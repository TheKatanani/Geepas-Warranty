import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const res: any = await admin.graphql(`#graphql
    query getProductImage {
      products(first: 1) {
        nodes {
          featuredImage {
            url
          }
        }
      }
    }
  `);

  const json = await res.json();
  console.log("Featured Image URL:\n", json.data.products.nodes[0].featuredImage.url);
}

main().catch(console.error);
