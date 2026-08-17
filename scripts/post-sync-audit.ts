import { fetchZohoItems } from "../app/services/zoho.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  console.log("==================================================");
  console.log("            POST-SYNC VERIFICATION AUDIT          ");
  console.log("==================================================");

  const zohoItems = await fetchZohoItems();
  const { admin } = await unauthenticated.admin(shop);

  let shopifyVariants: Array<{ sku: string }> = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const query = `#graphql
    query getVariants($cursor: String) {
      productVariants(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          sku
        }
      }
    }
  `;

  while (hasNextPage) {
    const response: any = await admin.graphql(query, { variables: { cursor } });
    const json: any = await response.json();
    const nodes = json.data?.productVariants?.nodes || [];

    for (const node of nodes) {
      if (node.sku) {
        shopifyVariants.push({ sku: node.sku.trim().toUpperCase() });
      }
    }

    hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
    cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
  }

  const shopifySkuSet = new Set(shopifyVariants.map(v => v.sku));

  let matched = 0;
  let missing = 0;

  zohoItems.forEach(item => {
    const sku = (item.sku || "").trim().toUpperCase();
    if (sku && shopifySkuSet.has(sku)) matched++;
    else if (sku) missing++;
  });

  console.log("--------------------------------------------------");
  console.log(` Live Zoho Items Catalog         : ${zohoItems.length}`);
  console.log(` Total Live Shopify Variants     : ${shopifyVariants.length}`);
  console.log(` Already Matched in Shopify      : ${matched}`);
  console.log(` Remaining Missing Items         : ${missing}`);
  console.log("==================================================");
}

main().catch(console.error);
