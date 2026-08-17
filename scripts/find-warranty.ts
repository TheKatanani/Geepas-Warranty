import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  try {
    const res = await admin.graphql(`
      query {
        products(first: 1, query: "handle:extended-warranty-3-years") {
          nodes {
            id
            title
            status
            variants(first: 5) {
              nodes {
                id
                title
              }
            }
          }
        }
      }
    `);
    const data = await res.json();
    console.log("Products query:", JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.log("Error:", err?.message);
    if (err?.graphQLErrors) {
      console.log("GraphQL Errors:", JSON.stringify(err.graphQLErrors, null, 2));
    }
  }
}

main().catch(console.error);
