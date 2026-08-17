import fs from "fs";
import path from "path";
import { fetchZohoItems } from "../app/services/zoho.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  console.log("==================================================");
  console.log("    LIVE ZOHO API ➔ LIVE SHOPIFY API COMPARISON   ");
  console.log("==================================================");

  // 1. Fetch 670 Items directly from LIVE Zoho Inventory API
  console.log("[Zoho API] Fetching live items directly from Zoho Inventory API...");
  const zohoItems = await fetchZohoItems();
  console.log(`[Zoho API] Successfully fetched ${zohoItems.length} active items directly from Zoho!`);

  // 2. Fetch Live Shopify Variants via GraphQL API
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  console.log(`[Shopify API] Fetching live variants from store (${shop})...`);
  
  let shopifyVariants: Array<{ id: string; sku: string; title: string; status: string }> = [];
  const { admin } = await unauthenticated.admin(shop);

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
          title
          product {
            title
            status
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
          title: `${node.product?.title || ""} - ${node.title}`,
          status: node.product?.status || "",
        });
      }
    }

    hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
    cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
  }
  console.log(`[Shopify API] Successfully fetched ${shopifyVariants.length} live product variants from Shopify.`);

  // 3. Compare Live Zoho vs Live Shopify
  const shopifySkuSet = new Set(shopifyVariants.map(v => v.sku));

  const matchedItems: typeof zohoItems = [];
  const missingItems: typeof zohoItems = [];

  let missingInStock = 0;
  let missingZeroStock = 0;

  for (const item of zohoItems) {
    const sku = (item.sku || "").trim().toUpperCase();
    if (sku && shopifySkuSet.has(sku)) {
      matchedItems.push(item);
    } else {
      missingItems.push(item);
      if ((item.stock_on_hand || 0) > 0) missingInStock++;
      else missingZeroStock++;
    }
  }

  console.log("\n==================================================");
  console.log("             100% LIVE API AUDIT RESULTS          ");
  console.log("==================================================");
  console.log(` 1. Total Live Zoho Items           : ${zohoItems.length}`);
  console.log(` 2. Total Live Shopify Variants     : ${shopifyVariants.length}`);
  console.log("--------------------------------------------------");
  console.log(` 3. Already Matched in Shopify      : ${matchedItems.length}`);
  console.log(` 4. 🎯 MISSING & NEED TO SYNC       : ${missingItems.length} items`);
  console.log(`    - In Stock in Zoho (Qty > 0)    : ${missingInStock} items`);
  console.log(`    - Zero Stock in Zoho (Qty = 0)  : ${missingZeroStock} items`);
  console.log("==================================================");

  if (missingItems.length > 0) {
    console.log("\nSample Live Missing Items (First 10):");
    missingItems.slice(0, 10).forEach((item, idx) => {
      console.log(` ${String(idx + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(12)} | Name: ${item.name.padEnd(35)} | Price: ${item.rate} IQD | Stock: ${item.stock_on_hand}`);
    });
  }

  // Save CSV for import
  const csvPath = path.resolve(process.cwd(), "..", "live_zoho_api_missing_items_for_shopify.csv");
  const csvLines = [
    "SKU,Name,Price,Stock",
    ...missingItems.map(i => `"${i.sku}","${i.name.replace(/"/g, '""')}",${i.rate},${i.stock_on_hand}`)
  ];
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf-8");
  console.log(`\n📄 Generated Live API missing items CSV: ${csvPath}`);
}

main().catch(console.error);
