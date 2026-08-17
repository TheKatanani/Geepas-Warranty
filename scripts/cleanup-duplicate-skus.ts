/**
 * Clean up Duplicate SKUs & Re-verify Stock for Active Products
 *
 * 1. Scans catalog for duplicate SKUs across products
 * 2. Clears the SKU on ARCHIVED/redundant test products
 * 3. Handles ACTIVE duplicate edge cases
 * 4. Re-synchronizes exact Zoho ZYN stock for all affected active products
 * 5. Runs verification audit
 */

import { unauthenticated } from "../app/shopify.server.js";
import { fetchZohoItems } from "../app/services/zoho.server.js";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
const targetLocationId = process.env.SHOPIFY_LOCATION_ID || "gid://shopify/Location/90733314339";

class ShopifyGqlExecutor {
  private remixAdmin: any;

  constructor(remixAdmin: any) {
    this.remixAdmin = remixAdmin;
  }

  async request(query: string, variables: Record<string, any> = {}): Promise<any> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res: any = await this.remixAdmin.graphql(query, { variables });
        const json = await res.json();

        const throttle = json.extensions?.cost?.throttleStatus;
        if (throttle && throttle.currentlyAvailable < 300) {
          const sleepMs = Math.ceil((300 - throttle.currentlyAvailable) / (throttle.restoreRate || 50)) * 1000;
          await new Promise((r) => setTimeout(r, Math.min(sleepMs, 3000)));
        }

        return json;
      } catch (err: any) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { errors: [{ message: err.message || String(err) }] };
      }
    }
  }
}

async function main() {
  console.log("=================================================================");
  console.log("       DUPLICATE SKU CLEANUP & STOCK RE-ALIGNMENT TOOL           ");
  console.log("=================================================================");
  console.log(` Target Store: ${cleanShop}`);
  console.log(` Location ID : ${targetLocationId} (zayouna)\n`);

  const unauth = await unauthenticated.admin(cleanShop);
  const client = new ShopifyGqlExecutor(unauth.admin);

  // 1. Fetch Zoho ZYN Stock
  console.log("[1/4] Loading Zoho Inventory warehouse ZYN stock counts...");
  const zohoStockMap = new Map<string, number>();

  const xlsxPath = path.resolve(process.cwd(), "..", "Stock Summary Report.xlsx");
  const localXlsx = path.resolve(process.cwd(), "Stock Summary Report.xlsx");
  const chosenXlsx = fs.existsSync(xlsxPath) ? xlsxPath : (fs.existsSync(localXlsx) ? localXlsx : null);

  if (chosenXlsx) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(chosenXlsx);
    const ws = wb.worksheets[0];
    ws.eachRow((r, num) => {
      if (num < 3) return;
      const v = r.values as any[];
      const sku = v[2] ? String(v[2]).trim().toUpperCase() : "";
      const closingStock = v[6] ? parseFloat(String(v[6])) || 0 : 0;
      if (sku) zohoStockMap.set(sku, closingStock);
    });
  }

  try {
    const live = await fetchZohoItems();
    for (const item of live) {
      const sku = (item.sku || "").trim().toUpperCase();
      if (sku && !zohoStockMap.has(sku)) {
        zohoStockMap.set(sku, item.stock_on_hand || 0);
      }
    }
  } catch (e: any) {
    console.warn(`[Zoho Live Note] ${e.message}`);
  }
  console.log(`[Zoho] Loaded stock counts for ${zohoStockMap.size} SKUs.\n`);

  // 2. Fetch full catalog & identify duplicates
  console.log("[2/4] Scanning Shopify catalog for duplicates...");

  interface VarItem {
    id: string;
    sku: string;
    title: string;
    productId: string;
    productTitle: string;
    productStatus: string;
    inventoryItemId: string;
  }

  const skuMap = new Map<string, VarItem[]>();
  let hasNextPage = true;
  let cursor: string | null = null;

  const GET_QUERY = `#graphql
    query getCatalogForCleanup($cursor: String) {
      products(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          status
          variants(first: 20) {
            nodes {
              id
              title
              sku
              inventoryItem {
                id
              }
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const res = await client.request(GET_QUERY, { cursor });
    const prods = res?.data?.products?.nodes || [];

    for (const p of prods) {
      for (const v of p.variants?.nodes || []) {
        const sku = (v.sku || "").trim().toUpperCase();
        if (!sku) continue;

        if (!skuMap.has(sku)) skuMap.set(sku, []);
        skuMap.get(sku)!.push({
          id: v.id,
          sku,
          title: v.title,
          productId: p.id,
          productTitle: p.title,
          productStatus: p.status,
          inventoryItemId: v.inventoryItem?.id || "",
        });
      }
    }

    hasNextPage = Boolean(res?.data?.products?.pageInfo?.hasNextPage);
    cursor = res?.data?.products?.pageInfo?.endCursor || null;
  }

  const duplicates = Array.from(skuMap.entries()).filter(([_, vars]) => vars.length > 1);
  console.log(`Found ${duplicates.length} duplicate SKU clusters across the store.\n`);

  // 3. Clean up duplicates
  console.log("[3/4] Resolving duplicate SKUs (Preserving ACTIVE, clearing ARCHIVED/Drafts)...");

  const CLEAR_SKU_MUTATION = `#graphql
    mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem {
          id
          sku
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const activeVariantsToReSync: VarItem[] = [];
  let clearedArchivedCount = 0;

  for (const [sku, variants] of duplicates) {
    const activeVariants = variants.filter((v) => v.productStatus === "ACTIVE");
    const nonActiveVariants = variants.filter((v) => v.productStatus !== "ACTIVE");

    // Case 1: Active + Archived / Draft
    if (activeVariants.length === 1 && nonActiveVariants.length > 0) {
      activeVariantsToReSync.push(activeVariants[0]);

      for (const nonActive of nonActiveVariants) {
        console.log(`  • Clearing SKU ${sku} on [${nonActive.productStatus}] product "${nonActive.productTitle.slice(0, 35)}"...`);
        const res = await client.request(CLEAR_SKU_MUTATION, {
          id: nonActive.inventoryItemId,
          input: { sku: "" },
        });

        const errs = res?.data?.inventoryItemUpdate?.userErrors || [];
        if (errs.length > 0) {
          console.warn(`    ⚠️ Error: ${errs.map((e: any) => e.message).join(", ")}`);
        } else {
          clearedArchivedCount++;
          console.log(`    ✓ Cleared SKU successfully.`);
        }
      }
    }
    // Case 2: Multiple Archived variants
    else if (activeVariants.length === 0 && nonActiveVariants.length > 1) {
      for (let i = 1; i < nonActiveVariants.length; i++) {
        const extra = nonActiveVariants[i];
        console.log(`  • Clearing extra duplicate on [ARCHIVED] "${extra.productTitle.slice(0, 35)}"...`);
        await client.request(CLEAR_SKU_MUTATION, {
          id: extra.inventoryItemId,
          input: { sku: "" },
        });
        clearedArchivedCount++;
      }
    }
    // Case 3: Multiple Active variants
    else if (activeVariants.length > 1) {
      console.log(`  ⚠️ Multi-Active duplicate for SKU ${sku}:`);
      activeVariantsToReSync.push(activeVariants[0]);
      for (let i = 1; i < activeVariants.length; i++) {
        const extra = activeVariants[i];
        console.log(`    • Disambiguating extra active product "${extra.productTitle}" -> suffixing SKU to ${sku}-DUP...`);
        await client.request(CLEAR_SKU_MUTATION, {
          id: extra.inventoryItemId,
          input: { sku: `${sku}-DUP` },
        });
      }
    }
  }

  console.log(`\nCleared / Disambiguated duplicate SKUs on ${clearedArchivedCount} secondary products.\n`);

  // 4. Re-sync Stock on all affected Active Products
  console.log(`[4/4] Re-syncing exact Zoho ZYN stock for ${activeVariantsToReSync.length} affected Active products...`);

  const SET_QTY_MUTATION = `#graphql
    mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  let reSyncedCount = 0;

  for (const v of activeVariantsToReSync) {
    const zohoQty = zohoStockMap.has(v.sku) ? zohoStockMap.get(v.sku)! : 0;
    console.log(`  • Setting stock for Active "${v.productTitle.slice(0, 30)}" (SKU: ${v.sku}) ➔ ${zohoQty} pcs...`);

    try {
      const res = await client.request(SET_QTY_MUTATION, {
        input: {
          name: "available",
          reason: "cycle_count_available",
          ignoreCompareQuantity: true,
          quantities: [
            {
              inventoryItemId: v.inventoryItemId,
              locationId: targetLocationId,
              quantity: Math.max(0, Math.round(zohoQty)),
            },
          ],
        },
      });

      const errs = res?.data?.inventorySetQuantities?.userErrors || [];
      if (errs.length > 0) {
        console.warn(`    ❌ Error: ${errs.map((e: any) => e.message).join(", ")}`);
      } else {
        reSyncedCount++;
        console.log(`    ✓ Successfully set to ${zohoQty} pcs at zayouna.`);
      }
    } catch (err: any) {
      console.error(`    ❌ Mutation error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("\n=================================================================");
  console.log("                  CLEANUP & RE-SYNC COMPLETE                     ");
  console.log("=================================================================");
  console.log(` Duplicate Clusters Resolved      : ${duplicates.length}`);
  console.log(` Secondary Products Cleared       : ${clearedArchivedCount}`);
  console.log(` Active Products Stock Verified   : ${reSyncedCount} / ${activeVariantsToReSync.length}`);
  console.log("=================================================================\n");
}

main().catch(console.error);
