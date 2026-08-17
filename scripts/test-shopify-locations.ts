import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log(`Fetching Shopify Locations for ${shop}...`);

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

  const res: any = await admin.graphql(query);
  const json: any = await res.json();
  console.log("Locations Nodes:\n", JSON.stringify(json.data?.locations?.nodes, null, 2));
}

main().catch(console.error);
