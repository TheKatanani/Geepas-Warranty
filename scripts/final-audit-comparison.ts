import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { unauthenticated } from "../app/shopify.server.js";

interface ZynExcelRecord {
  name: string;
  sku: string;
  openingStock: number;
  qtyIn: number;
  qtyOut: number;
  closingStock: number;
}

interface ShopifyApiRecord {
  id: string;
  sku: string;
  title: string;
  handle: string;
  status: string;
  inventoryQuantity?: number;
}

async function main() {
  console.log("==================================================");
  console.log("       FINAL AUDIT COMPARISON REPORT              ");
  console.log("==================================================");

  // 1. Parse Stock Summary Report.xlsx
  const xlsxPath = path.resolve(process.cwd(), "..", "Stock Summary Report.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    console.error("Stock Summary Report.xlsx not found!");
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];

  const zynItems: ZynExcelRecord[] = [];
  const zynSkuMap = new Map<string, ZynExcelRecord>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return; // Skip title and column headers
    const values = row.values as any[];
    const name = values[1] ? String(values[1]).trim() : "";
    const sku = values[2] ? String(values[2]).trim() : "";
    const closingStock = values[6] ? parseFloat(String(values[6])) || 0 : 0;

    if (sku || name) {
      const record: ZynExcelRecord = {
        name: name || sku,
        sku: sku.toUpperCase(),
        openingStock: values[3] ? parseFloat(String(values[3])) || 0 : 0,
        qtyIn: values[4] ? parseFloat(String(values[4])) || 0 : 0,
        qtyOut: values[5] ? parseFloat(String(values[5])) || 0 : 0,
        closingStock,
      };
      zynItems.push(record);
      if (record.sku) zynSkuMap.set(record.sku, record);
    }
  });

  // 2. Fetch Live Shopify Variants via GraphQL API
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  console.log(`[Shopify API] Fetching live product catalog from ${shop}...`);

  const shopifyVariants: ShopifyApiRecord[] = [];
  const shopifySkuMap = new Map<string, ShopifyApiRecord[]>();

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
          inventoryQuantity
          product {
            title
            handle
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
      const sku = (node.sku || "").trim().toUpperCase();
      const rec: ShopifyApiRecord = {
        id: node.id,
        sku,
        title: `${node.product?.title || ""} - ${node.title}`,
        handle: node.product?.handle || "",
        status: node.product?.status || "",
        inventoryQuantity: node.inventoryQuantity,
      };

      shopifyVariants.push(rec);

      if (sku) {
        if (!shopifySkuMap.has(sku)) shopifySkuMap.set(sku, []);
        shopifySkuMap.get(sku)!.push(rec);
      }
    }

    hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
    cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
  }

  // 3. Detailed Audit Calculations
  const inZynAndShopify: ZynExcelRecord[] = [];
  const inZynButMissingShopify: ZynExcelRecord[] = [];

  let inZynStockPositiveMissingShopify = 0;
  let inZynStockZeroMissingShopify = 0;

  for (const item of zynItems) {
    if (item.sku && shopifySkuMap.has(item.sku)) {
      inZynAndShopify.push(item);
    } else {
      inZynButMissingShopify.push(item);
      if (item.closingStock > 0) {
        inZynStockPositiveMissingShopify++;
      } else {
        inZynStockZeroMissingShopify++;
      }
    }
  }

  // Find Shopify variants NOT in ZYN Excel Report
  const inShopifyButNotInZyn: ShopifyApiRecord[] = [];
  for (const varItem of shopifyVariants) {
    if (varItem.sku && !zynSkuMap.has(varItem.sku)) {
      inShopifyButNotInZyn.push(varItem);
    }
  }

  // Status breakdown of Shopify variants that match ZYN
  const matchedShopifyStatusCounts: Record<string, number> = {};
  for (const item of inZynAndShopify) {
    const vars = shopifySkuMap.get(item.sku) || [];
    for (const v of vars) {
      matchedShopifyStatusCounts[v.status] = (matchedShopifyStatusCounts[v.status] || 0) + 1;
    }
  }

  // Output Full Comparison Report
  console.log("\n==================================================");
  console.log("              COMPREHENSIVE AUDIT REPORT          ");
  console.log("==================================================");
  console.log(`1. Total Items in ZYN Export (Excel)      : ${zynItems.length}`);
  console.log(`2. Total Product Variants in Live Shopify  : ${shopifyVariants.length}`);
  console.log("--------------------------------------------------");
  console.log(`3. Items Matched (Exist in BOTH ZYN & Shopify) : ${inZynAndShopify.length}`);
  console.log(`   - Matched Shopify Active Products       : ${matchedShopifyStatusCounts["ACTIVE"] || 0}`);
  console.log(`   - Matched Shopify Draft Products        : ${matchedShopifyStatusCounts["DRAFT"] || 0}`);
  console.log(`   - Matched Shopify Archived Products     : ${matchedShopifyStatusCounts["ARCHIVED"] || 0}`);
  console.log("--------------------------------------------------");
  console.log(`4. Items in ZYN but MISSING in Shopify     : ${inZynButMissingShopify.length}`);
  console.log(`   - With In-Stock Quantity (Closing > 0)  : ${inZynStockPositiveMissingShopify}`);
  console.log(`   - Out of Stock / Zero Quantity (Closing 0): ${inZynStockZeroMissingShopify}`);
  console.log("--------------------------------------------------");
  console.log(`5. Items in Shopify but NOT in ZYN Export   : ${inShopifyButNotInZyn.length}`);
  console.log("==================================================");

  // Write detailed JSON audit log for verification
  const auditSummary = {
    totalZynExcelItems: zynItems.length,
    totalShopifyLiveVariants: shopifyVariants.length,
    matchedCount: inZynAndShopify.length,
    missingCount: inZynButMissingShopify.length,
    missingInStock: inZynStockPositiveMissingShopify,
    missingZeroStock: inZynStockZeroMissingShopify,
    shopifyOnlyCount: inShopifyButNotInZyn.length,
    matchedShopifyStatusCounts,
    missingItemsPreview: inZynButMissingShopify.slice(0, 20).map(i => ({
      sku: i.sku,
      name: i.name,
      closingStock: i.closingStock,
    })),
    shopifyOnlyPreview: inShopifyButNotInZyn.slice(0, 20).map(i => ({
      sku: i.sku,
      title: i.title,
      status: i.status,
    })),
  };

  const auditPath = path.resolve(process.cwd(), "..", "final_zyn_shopify_audit_report.json");
  fs.writeFileSync(auditPath, JSON.stringify(auditSummary, null, 2), "utf-8");
  console.log(`\n📄 Saved full JSON audit report: ${auditPath}`);
}

main().catch(console.error);
