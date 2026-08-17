import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { unauthenticated } from "../app/shopify.server.js";

interface ExcelZynItem {
  name: string;
  sku: string;
  openingStock: number;
  qtyIn: number;
  qtyOut: number;
  closingStock: number;
}

async function main() {
  console.log("==================================================");
  console.log("    ZYN WAREHOUSE EXCEL REPORT SYNC ANALYSIS     ");
  console.log("==================================================");

  const xlsxPath = path.resolve(process.cwd(), "..", "Stock Summary Report.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    console.error("Stock Summary Report.xlsx not found at", xlsxPath);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];

  const excelItems: ExcelZynItem[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return; // Skip headers

    const values = row.values as any[];
    const name = values[1] ? String(values[1]).trim() : "";
    const sku = values[2] ? String(values[2]).trim() : "";
    const closingStock = values[6] ? parseFloat(String(values[6])) || 0 : 0;

    if (sku || name) {
      excelItems.push({
        name: name || sku,
        sku,
        openingStock: values[3] ? parseFloat(String(values[3])) || 0 : 0,
        qtyIn: values[4] ? parseFloat(String(values[4])) || 0 : 0,
        qtyOut: values[5] ? parseFloat(String(values[5])) || 0 : 0,
        closingStock,
      });
    }
  });

  console.log(`[ZYN Excel Export] Loaded ${excelItems.length} total items from Stock Summary Report.xlsx!`);

  // Query Live Shopify Admin GraphQL API
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  console.log(`[Shopify API] Fetching live variants from store (${shop})...`);
  
  let shopifyVariants: Array<{ id: string; sku: string; title: string }> = [];

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
            title
            product {
              title
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
          });
        }
      }

      hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
      cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
    }
    console.log(`[Shopify API] Loaded ${shopifyVariants.length} live product variants from Shopify.`);
  } catch (err: any) {
    console.error("Shopify fetch failed:", err.message);
  }

  const shopifySkuSet = new Set(shopifyVariants.map(v => v.sku.toUpperCase()));

  const matchedInShopify: ExcelZynItem[] = [];
  const missingInShopify: ExcelZynItem[] = [];

  for (const item of excelItems) {
    const sku = item.sku.toUpperCase();
    if (sku && shopifySkuSet.has(sku)) {
      matchedInShopify.push(item);
    } else {
      missingInShopify.push(item);
    }
  }

  console.log("--------------------------------------------------");
  console.log("             CORRECTED ZYN AUDIT RESULTS          ");
  console.log("--------------------------------------------------");
  console.log(` Total Items in ZYN Report (Excel) : ${excelItems.length}`);
  console.log(` Total Shopify Live Variants       : ${shopifyVariants.length}`);
  console.log(` Already Matched in Shopify        : ${matchedInShopify.length}`);
  console.log(` 🎯 MISSING & NEED TO SYNC         : ${missingInShopify.length} items`);
  console.log("--------------------------------------------------");

  if (missingInShopify.length > 0) {
    console.log("\nSample Missing ZYN Items from Excel Report (Top 10):");
    missingInShopify.slice(0, 10).forEach((item, idx) => {
      console.log(` ${String(idx + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(12)} | Name: ${item.name.padEnd(35)} | Stock: ${item.closingStock}`);
    });
  }

  // Generate clean export CSV of missing ZYN items from Excel report
  const missingCsvPath = path.resolve(process.cwd(), "..", "zyn_excel_missing_products_for_shopify.csv");
  const csvLines = [
    "SKU,Item Name,Closing Stock",
    ...missingInShopify.map(i => `"${i.sku}","${i.name.replace(/"/g, '""')}",${i.closingStock}`)
  ];
  fs.writeFileSync(missingCsvPath, csvLines.join("\n"), "utf-8");
  console.log(`\n📄 Generated updated ZYN missing items export: ${missingCsvPath}`);
}

main().catch(console.error);
