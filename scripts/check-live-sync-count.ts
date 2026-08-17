import fs from "fs";
import path from "path";
import { parseZohoCsv } from "../app/services/zoho.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  console.log("==================================================");
  console.log("    LIVE API PRODUCT SYNC AUDIT & COUNT TOOL     ");
  console.log("==================================================");
  console.log(` Target Shop      : ${shop}`);
  console.log("--------------------------------------------------");

  // 1. Load ZYN items from Zoho (from Item.csv)
  const itemCsvPath = path.resolve(process.cwd(), "Item.csv");
  if (!fs.existsSync(itemCsvPath)) {
    console.error("Item.csv not found.");
    return;
  }
  const zohoItems = parseZohoCsv(fs.readFileSync(itemCsvPath, "utf-8"));
  
  // Filter ZYN items
  const zynItems = zohoItems.filter(item => {
    const loc = (item.location_name || item.warehouse_name || "").toUpperCase();
    return !loc || loc.includes("ZYN");
  });

  console.log(`[Zoho Data] Total items in catalog: ${zohoItems.length}`);
  console.log(`[Zoho Data] Total items for ZYN Warehouse: ${zynItems.length}`);

  // 2. Fetch Live Shopify Variants using Admin GraphQL API
  console.log(`[Shopify API] Fetching live product variants from Shopify store (${shop})...`);
  let shopifyVariants: Array<{ id: string; sku: string; title: string; price: string }> = [];

  try {
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
            price
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
            sku: node.sku.trim(),
            title: `${node.product?.title || ""} - ${node.title}`,
            price: node.price,
          });
        }
      }

      hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
      cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
    }
    console.log(`[Shopify API] Successfully fetched ${shopifyVariants.length} live product variants from Shopify!`);
  } catch (err: any) {
    console.warn(`[Shopify API Warning] Could not fetch live API: ${err.message}. Using products_export.csv fallback.`);
    const shopifyCsvPath = path.resolve(process.cwd(), "..", "products_export.csv");
    if (fs.existsSync(shopifyCsvPath)) {
      const content = fs.readFileSync(shopifyCsvPath, "utf-8");
      // simple line count check
      const lines = content.split("\n").filter(l => l.trim());
      console.log(`[Shopify CSV] Found ${lines.length - 1} lines in export file.`);
    }
  }

  // 3. Compare ZYN items vs Shopify Live variants
  const shopifySkuSet = new Set(shopifyVariants.map(v => v.sku.toUpperCase()));

  const matchedItems: typeof zynItems = [];
  const missingItems: typeof zynItems = [];

  for (const item of zynItems) {
    const sku = item.sku.trim().toUpperCase();
    if (sku && shopifySkuSet.has(sku)) {
      matchedItems.push(item);
    } else {
      missingItems.push(item);
    }
  }

  console.log("--------------------------------------------------");
  console.log("                   SUMMARY RESULTS                ");
  console.log("--------------------------------------------------");
  console.log(` Total Zoho ZYN Items         : ${zynItems.length}`);
  console.log(` Total Live Shopify Variants  : ${shopifyVariants.length}`);
  console.log(` Already Matched in Shopify   : ${matchedItems.length}`);
  console.log(` 🎯 NEED TO SYNC FROM ZYN     : ${missingItems.length} items`);
  console.log("--------------------------------------------------");

  if (missingItems.length > 0) {
    console.log("\nFirst 10 ZYN Items to sync to Shopify:");
    missingItems.slice(0, 10).forEach((item, index) => {
      console.log(` ${String(index + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(12)} | Name: ${item.name.padEnd(35)} | Price: ${item.rate} IQD`);
    });
  }
}

main().catch(console.error);
