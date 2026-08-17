import fs from "fs";
import path from "path";
import { parseZohoCsv, ZohoItem } from "../app/services/zoho.server.js";

function parseShopifyCsvVariants(csvPath: string): Array<{ handle: string; title: string; sku: string; status: string }> {
  if (!fs.existsSync(csvPath)) return [];
  const csvContent = fs.readFileSync(csvPath, "utf-8");

  const lines: string[] = [];
  let currentLine = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csvContent[i + 1] === "\n") i++;
      if (currentLine.trim()) lines.push(currentLine);
      currentLine = "";
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let inside = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inside && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inside = !inside;
        }
      } else if (c === ',' && !inside) {
        fields.push(field.trim());
        field = "";
      } else {
        field += c;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const handleIdx = headers.findIndex(h => h.toLowerCase() === "handle");
  const titleIdx = headers.findIndex(h => h.toLowerCase() === "title");
  const skuIdx = headers.findIndex(h => h.toLowerCase() === "variant sku");
  const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");

  if (skuIdx === -1) return [];

  const variants: Array<{ handle: string; title: string; sku: string; status: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    const sku = skuIdx !== -1 && row[skuIdx] ? row[skuIdx].trim() : "";
    const handle = handleIdx !== -1 && row[handleIdx] ? row[handleIdx].trim() : "";
    const title = titleIdx !== -1 && row[titleIdx] ? row[titleIdx].trim() : "";
    const status = statusIdx !== -1 && row[statusIdx] ? row[statusIdx].trim() : "";

    if (sku) {
      variants.push({ handle, title, sku, status });
    }
  }

  return variants;
}

async function main() {
  console.log("==================================================");
  console.log("   SHOPIFY NON-ZYN PRODUCTS DISCOVERY TOOL        ");
  console.log("==================================================");

  // 1. Load Zoho ZYN Items
  const itemCsvPath = path.resolve(process.cwd(), "Item.csv");
  if (!fs.existsSync(itemCsvPath)) {
    console.error("Item.csv not found at", itemCsvPath);
    return;
  }

  const zohoItems = parseZohoCsv(fs.readFileSync(itemCsvPath, "utf-8"));
  const zynItems = zohoItems.filter(item => {
    const loc = (item.location_name || item.warehouse_name || "").toUpperCase();
    return !loc || loc.includes("ZYN");
  });

  const zynSkus = new Set(zynItems.map(i => (i.sku || "").trim().toUpperCase()).filter(Boolean));
  console.log(`[Zoho ZYN] Loaded ${zynItems.length} items for ZYN warehouse.`);

  // 2. Load Shopify variants
  const shopifyCsvPath = path.resolve(process.cwd(), "..", "products_export.csv");
  if (!fs.existsSync(shopifyCsvPath)) {
    console.error("products_export.csv not found at", shopifyCsvPath);
    return;
  }

  const shopifyVariants = parseShopifyCsvVariants(shopifyCsvPath);
  console.log(`[Shopify Export] Loaded ${shopifyVariants.length} total Shopify product variants.`);

  // 3. Find Shopify items that are NOT in ZYN
  const nonZynItems = shopifyVariants.filter(v => {
    const sku = (v.sku || "").trim().toUpperCase();
    return sku && !zynSkus.has(sku);
  });

  console.log("--------------------------------------------------");
  console.log(` Total Shopify Variants         : ${shopifyVariants.length}`);
  console.log(` Shopify Items matching ZYN     : ${shopifyVariants.length - nonZynItems.length}`);
  console.log(` Shopify Items NOT in ZYN       : ${nonZynItems.length}`);
  console.log("--------------------------------------------------");

  if (nonZynItems.length === 0) {
    console.log("🎉 All Shopify items exist in ZYN warehouse!");
    return;
  }

  // Export report
  const reportCsvPath = path.resolve(process.cwd(), "..", "shopify_non_zyn_products_to_cleanup.csv");
  const csvLines = [
    "Handle,Title,Variant SKU,Status,Action Suggested",
    ...nonZynItems.map(i => `"${i.handle}","${i.title}","${i.sku}","${i.status}","ARCHIVE_OR_DELETE"`)
  ];
  fs.writeFileSync(reportCsvPath, csvLines.join("\n"), "utf-8");

  console.log(`\n📄 Generated Cleanup List CSV:`);
  console.log(`   ${reportCsvPath}`);

  console.log("\nTop 15 Non-ZYN Shopify Items found:");
  nonZynItems.slice(0, 15).forEach((item, idx) => {
    console.log(` ${String(idx + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(12)} | Title: ${item.title.padEnd(35)} | Status: ${item.status}`);
  });
  if (nonZynItems.length > 15) {
    console.log(` ... and ${nonZynItems.length - 15} more non-ZYN items.`);
  }
}

main().catch(console.error);
