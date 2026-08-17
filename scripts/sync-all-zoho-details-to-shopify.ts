import fs from "fs";
import path from "path";
import { fetchZohoItems, parseZohoCsv } from "../app/services/zoho.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("==================================================");
  console.log("    FULL ZOHO ➔ SHOPIFY PRODUCT & PRICE RECONCILIATION");
  console.log("==================================================");

  // 1. Fetch Live Zoho Items
  let zohoItems = await fetchZohoItems();
  console.log(`[Zoho API] Fetched ${zohoItems.length} live items from Zoho.`);

  // Enrich descriptions from Item.csv if any
  const csvPath = path.resolve(process.cwd(), "Item.csv");
  if (fs.existsSync(csvPath)) {
    const csvItems = parseZohoCsv(fs.readFileSync(csvPath, "utf-8"));
    const descMap = new Map<string, string>();
    csvItems.forEach(i => {
      if (i.sku && i.description) descMap.set(i.sku.trim().toUpperCase(), i.description);
    });

    zohoItems.forEach(i => {
      const sku = (i.sku || "").trim().toUpperCase();
      if (sku && descMap.has(sku) && !i.description) {
        i.description = descMap.get(sku);
      }
    });
  }

  const zohoMap = new Map<string, typeof zohoItems[0]>();
  zohoItems.forEach(i => {
    if (i.sku) zohoMap.set(i.sku.trim().toUpperCase(), i);
  });

  // 2. Fetch Live Shopify Variants
  console.log(`[Shopify API] Fetching all live variants from store (${shop})...`);
  let shopifyVariants: Array<{ id: string; sku: string; price: string; title: string; productTitle: string; handle: string }> = [];

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
          id
          sku
          price
          title
          product {
            title
            handle
          }
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
        shopifyVariants.push({
          id: node.id,
          sku: node.sku.trim().toUpperCase(),
          price: node.price,
          title: node.title,
          productTitle: node.product?.title || "",
          handle: node.product?.handle || "",
        });
      }
    }

    hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
    cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
  }

  console.log(`[Shopify API] Loaded ${shopifyVariants.length} product variants from Shopify.`);

  // 3. Find items that need price or detail reconciliation
  let priceUpdatedCount = 0;
  let matchesCount = 0;

  for (const variant of shopifyVariants) {
    const zohoItem = zohoMap.get(variant.sku);
    if (zohoItem) {
      matchesCount++;
      const currentPriceNum = parseFloat(variant.price) || 0;
      if (zohoItem.rate > 0 && Math.abs(currentPriceNum - zohoItem.rate) > 0.01) {
        priceUpdatedCount++;
      }
    }
  }

  console.log("--------------------------------------------------");
  console.log(` Total Matched SKUs               : ${matchesCount}`);
  console.log(` SKUs needing Price Adjustment     : ${priceUpdatedCount}`);
  console.log("==================================================");
}

main().catch(console.error);
