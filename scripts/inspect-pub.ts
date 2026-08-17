import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  // Query product publications status
  const res = await admin.graphql(`
    query {
      product(id: "gid://shopify/Product/10332687401251") {
        id
        title
        status
        publishedOnPublication(publicationId: "gid://shopify/Publication/159373394211")
        resourcePublications(first: 10) {
          nodes {
            isPublished
            publication {
              id
            }
          }
        }
      }
    }
  `);
  
  const text = await res.text();
  console.log("Raw Response:", text);
}

main().catch(console.error);
