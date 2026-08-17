import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const res: any = await admin.graphql(`#graphql
    query getArchivedProds {
      products(first: 100, query: "status:ARCHIVED") {
        nodes {
          id
          title
          status
          variants(first: 5) {
            nodes {
              id
              sku
              inventoryQuantity
            }
          }
        }
      }
    }
  `);

  const json = await res.json();
  const prods = json?.data?.products?.nodes || [];

  console.log(`Total Archived Products found: ${prods.length}`);
  prods.forEach((p: any, i: number) => {
    const v = p.variants?.nodes?.[0];
    console.log(`${(i + 1).toString().padStart(2)}. [${p.id}] "${p.title}" | SKU: "${v?.sku || "(NONE)"}" | Qty: ${v?.inventoryQuantity}`);
  });
}

main().catch(console.error);
