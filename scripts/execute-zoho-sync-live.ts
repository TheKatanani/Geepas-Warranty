import fs from "fs";
import path from "path";
import { fetchZohoItems, parseZohoCsv, ZohoItem } from "../app/services/zoho.server.js";
import {
  fetchAllShopifyVariants,
  diffZohoAndShopify,
  createShopifyProductFromZoho,
} from "../app/services/zoho-product-sync.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  const statusArg = args.find((a) => a.startsWith("--status="))?.split("=")[1]?.toUpperCase();
  const status = (statusArg === "DRAFT" ? "DRAFT" : "ACTIVE") as "ACTIVE" | "DRAFT";

  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";

  console.log("==================================================");
  console.log("     ZOHO ➔ SHOPIFY LIVE PRODUCT CREATION SYNC   ");
  console.log("==================================================");
  console.log(` Target Shop      : ${shop}`);
  console.log(` Mode             : ${commit ? "LIVE CREATION (Commit)" : "DRY RUN (Preview Only)"}`);
  console.log(` Status           : ${status}`);
  if (limit) console.log(` Limit            : ${limit} items max`);
  console.log("--------------------------------------------------");

  // 1. Fetch Zoho Items directly from Live API (fallback to local CSV if any item missing)
  let zohoItems: ZohoItem[] = [];
  try {
    console.log("[Zoho API] Fetching live items directly from Zoho Inventory API...");
    zohoItems = await fetchZohoItems();
    console.log(`[Zoho API] Successfully fetched ${zohoItems.length} active items directly from Zoho!`);
  } catch (err: any) {
    console.warn(`[Zoho API Warning] API fetch error: ${err.message}. Reading local CSV fallback...`);
    const csvPath = path.resolve(process.cwd(), "Item.csv");
    if (fs.existsSync(csvPath)) {
      zohoItems = parseZohoCsv(fs.readFileSync(csvPath, "utf-8"));
      console.log(`[CSV Fallback] Loaded ${zohoItems.length} items from Item.csv.`);
    }
  }

  // Enrich descriptions from Item.csv if live API returned plain text
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

  // 2. Fetch Live Shopify Variants using Admin GraphQL API
  console.log(`[Shopify API] Fetching live variants from store (${shop})...`);
  const { admin } = await unauthenticated.admin(shop);
  const shopifyVariants = await fetchAllShopifyVariants(admin);
  console.log(`[Shopify API] Loaded ${shopifyVariants.length} existing Shopify product variants.`);

  // 3. Diff items
  const diff = diffZohoAndShopify(zohoItems, shopifyVariants);
  console.log("--------------------------------------------------");
  console.log(` Total Zoho Items            : ${diff.totalZohoItems}`);
  console.log(` Existing Shopify Variants   : ${diff.totalShopifyVariants}`);
  console.log(` Already Matched in Shopify  : ${diff.matchedCount}`);
  console.log(` 🎯 MISSING & NEED TO SYNC   : ${diff.missingItems.length}`);
  console.log("--------------------------------------------------");

  if (diff.missingItems.length === 0) {
    console.log("🎉 All Zoho items already exist in Shopify! No action needed.");
    return;
  }

  let itemsToSync = diff.missingItems;

  // Filter for items that have non-empty SKU
  itemsToSync = itemsToSync.filter(i => i.sku && i.sku.trim());

  if (limit && limit > 0) {
    itemsToSync = itemsToSync.slice(0, limit);
    console.log(`⚠️ Limiting sync to first ${itemsToSync.length} missing items.`);
  }

  if (!commit) {
    console.log(`\n[Dry Run Summary] Top 10 items ready for creation:`);
    itemsToSync.slice(0, 10).forEach((item, idx) => {
      console.log(` ${String(idx + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(12)} | Name: ${item.name.padEnd(35)} | Price: ${item.rate} IQD | Desc: ${item.description ? "Yes" : "No"}`);
    });
    console.log("\n💡 To execute live creation, run:");
    console.log("   npx tsx --env-file=.env scripts/execute-zoho-sync-live.ts --commit");
    console.log("   npx tsx --env-file=.env scripts/execute-zoho-sync-live.ts --commit --status=DRAFT");
    console.log("   npx tsx --env-file=.env scripts/execute-zoho-sync-live.ts --commit --limit=10");
    return;
  }

  // 4. Live Creation
  console.log(`\n🚀 Starting live creation of ${itemsToSync.length} items in Shopify (Status: ${status})...\n`);

  const created: Array<{ sku: string; id: string; name: string }> = [];
  const failed: Array<{ sku: string; error: string }> = [];

  for (let i = 0; i < itemsToSync.length; i++) {
    const item = itemsToSync[i];
    console.log(`[${i + 1}/${itemsToSync.length}] Creating SKU: ${item.sku} - "${item.name}"...`);

    const result = await createShopifyProductFromZoho(admin, item, { status });

    if (result.success && result.shopifyProductId) {
      console.log(`   ✓ Created Shopify Product: ${result.shopifyProductId}`);
      created.push({
        sku: item.sku,
        id: result.shopifyProductId,
        name: item.name,
      });
    } else {
      console.error(`   ❌ Failed to create SKU ${item.sku}: ${result.error}`);
      failed.push({
        sku: item.sku,
        error: result.error || "Unknown error",
      });
    }

    // Small rate-limit delay
    await new Promise(r => setTimeout(r, 250));
  }

  console.log("\n==================================================");
  console.log("             LIVE SYNC EXECUTION RESULTS          ");
  console.log("==================================================");
  console.log(` Total Processed  : ${itemsToSync.length}`);
  console.log(` Successfully Created : ${created.length}`);
  console.log(` Failed           : ${failed.length}`);
  console.log("==================================================");

  if (failed.length > 0) {
    console.log("\nFailed Items Log:");
    failed.forEach(f => console.log(` - SKU: ${f.sku} | Error: ${f.error}`));
  }
}

main().catch(console.error);
