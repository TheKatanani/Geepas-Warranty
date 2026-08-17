import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const query = `#graphql
    query getLocations {
      locations(first: 10) {
        nodes {
          id
          name
          isActive
        }
      }
    }
  `;

  try {
    const res: any = await admin.graphql(query);
    const json: any = await res.json();
    if (json.errors) {
      console.log("GraphQL Errors:", JSON.stringify(json.errors, null, 2));
    } else {
      console.log("Locations:", JSON.stringify(json.data?.locations?.nodes, null, 2));
    }
  } catch (e: any) {
    console.error("Exception:", e.message);
  }
}

main().catch(console.error);
