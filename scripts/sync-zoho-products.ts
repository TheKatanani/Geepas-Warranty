import fs from "fs";
import path from "path";
import { fetchZohoItems, parseZohoCsv, ZohoItem } from "../app/services/zoho.server.js";
import {
  fetchAllShopifyVariants,
  diffZohoAndShopify,
  createShopifyProductFromZoho,
} from "../app/services/zoho-product-sync.server.js";

function parseShopifyCsvVariants(csvPath: string): Array<{ sku: string; barcode?: string }> {
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
  const skuIdx = headers.findIndex(h => h.toLowerCase() === "variant sku");
  const barcodeIdx = headers.findIndex(h => h.toLowerCase() === "variant barcode");

  if (skuIdx === -1) return [];

  const variants: Array<{ sku: string; barcode?: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    const sku = skuIdx !== -1 && row[skuIdx] ? row[skuIdx].trim() : "";
    if (sku) {
      variants.push({
        sku,
        barcode: barcodeIdx !== -1 && row[barcodeIdx] ? row[barcodeIdx].trim() : undefined,
      });
    }
  }

  return variants;
}

function generateShopifyCsv(missingItems: ZohoItem[], status: string): string {
  const headers = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Product Category",
    "Type",
    "Tags",
    "Published",
    "Option1 Name",
    "Option1 Value",
    "Variant SKU",
    "Variant Grams",
    "Variant Inventory Tracker",
    "Variant Inventory Policy",
    "Variant Fulfillment Service",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Variant Barcode",
    "Variant Inventory Qty",
    "Status"
  ];

  const escapeCsv = (val: string | number | undefined | null): string => {
    if (val === undefined || val === null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows: string[] = [headers.join(",")];

  for (const item of missingItems) {
    const title = item.name.trim() || item.sku.trim();
    const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const description = item.description || title;
    const bodyHtml = `<p>${description.replace(/\n/g, "<br/>")}</p>`;
    const vendor = item.brand || "GEEPAS";
    const type = item.category_name || "General";
    const sku = item.sku.trim();
    const price = Math.max(0, item.rate).toString();
    const barcode = item.upc || item.ean || sku;
    const qty = Math.max(0, item.stock_on_hand || 0).toString();

    const row = [
      escapeCsv(handle),
      escapeCsv(title),
      escapeCsv(bodyHtml),
      escapeCsv(vendor),
      escapeCsv("Uncategorized"),
      escapeCsv(type),
      escapeCsv("Zoho Import, Warehouse: ZYN"),
      escapeCsv("TRUE"),
      escapeCsv("Title"),
      escapeCsv("Default Title"),
      escapeCsv(sku),
      escapeCsv("0"),
      escapeCsv("shopify"),
      escapeCsv("deny"),
      escapeCsv("manual"),
      escapeCsv(price),
      escapeCsv(""),
      escapeCsv("TRUE"),
      escapeCsv("FALSE"),
      escapeCsv(barcode),
      escapeCsv(qty),
      escapeCsv(status.toLowerCase())
    ];

    rows.push(row.join(","));
  }

  return rows.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const dryRun = !commit || args.includes("--dry-run");

  const statusArg = args.find((a) => a.startsWith("--status="))?.split("=")[1]?.toUpperCase();
  const status = (statusArg === "DRAFT" ? "DRAFT" : "ACTIVE") as "ACTIVE" | "DRAFT";

  const warehouseArg = args.find((a) => a.startsWith("--warehouse="))?.split("=")[1] || "ZYN";

  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  const csvArg = args.find((a) => a.startsWith("--csv="))?.split("=")[1];
  const shopArg = args.find((a) => a.startsWith("--shop="))?.split("=")[1] || process.env.SHOP || "geepas-iraq.myshopify.com";

  console.log("==================================================");
  console.log("      ZOHO ➔ SHOPIFY PRODUCT CREATION SYNC TOOL   ");
  console.log("==================================================");
  console.log(` Target Shop      : ${shopArg}`);
  console.log(` Warehouse Filter : ${warehouseArg}`);
  console.log(` Mode             : ${commit ? "COMMIT (Live Creation)" : "DRY RUN (Scan & Export CSV)"}`);
  console.log(` Status           : ${status}`);
  if (limit) console.log(` Limit            : ${limit} items max`);
  console.log("--------------------------------------------------");

  // 1. Load Zoho Items (from CSV file if available or Zoho API)
  let zohoItems: ZohoItem[] = [];
  const defaultCsvPath = path.resolve(process.cwd(), "..", "Item.csv");
  const localCsvPath = path.resolve(process.cwd(), "Item.csv");
  const targetCsvPath = csvArg ? path.resolve(process.cwd(), csvArg) : (fs.existsSync(defaultCsvPath) ? defaultCsvPath : (fs.existsSync(localCsvPath) ? localCsvPath : null));

  if (targetCsvPath && fs.existsSync(targetCsvPath)) {
    console.log(`[Source] Reading Zoho items from local CSV: ${targetCsvPath}`);
    const csvData = fs.readFileSync(targetCsvPath, "utf-8");
    zohoItems = parseZohoCsv(csvData);
  } else {
    console.log(`[Source] Fetching items directly from Zoho Inventory API...`);
    zohoItems = await fetchZohoItems();
  }

  console.log(`[Zoho] Loaded ${zohoItems.length} total items from Zoho.`);

  // 2. Fetch Shopify Variants (from local products_export.csv first or API)
  let shopifyVariants: Array<{ sku: string; barcode?: string }> = [];
  const defaultShopifyCsv = path.resolve(process.cwd(), "..", "products_export.csv");
  const localShopifyCsv = path.resolve(process.cwd(), "products_export.csv");
  const shopifyCsvPath = fs.existsSync(defaultShopifyCsv) ? defaultShopifyCsv : (fs.existsSync(localShopifyCsv) ? localShopifyCsv : null);

  if (shopifyCsvPath) {
    console.log(`[Shopify CSV] Reading existing Shopify variants from local export: ${shopifyCsvPath}`);
    shopifyVariants = parseShopifyCsvVariants(shopifyCsvPath);
  }

  console.log(`[Shopify] Loaded ${shopifyVariants.length} existing Shopify product variants.`);

  // 3. Diff items with Warehouse Filter
  const diff = diffZohoAndShopify(zohoItems, shopifyVariants, { warehouseFilter: warehouseArg });
  console.log("--------------------------------------------------");
  console.log(` Total Zoho Items            : ${diff.totalZohoItems}`);
  console.log(` Items in Warehouse [${warehouseArg}]   : ${diff.filteredZohoItems}`);
  console.log(` Total Shopify Variants      : ${diff.totalShopifyVariants}`);
  console.log(` Already Matched (In Shopify): ${diff.matchedCount}`);
  console.log(` Missing In Shopify (${warehouseArg})   : ${diff.missingItems.length}`);
  console.log("--------------------------------------------------");

  if (diff.missingItems.length === 0) {
    console.log(`🎉 All items from warehouse [${warehouseArg}] already exist in Shopify! No action needed.`);
    return;
  }

  let itemsToSync = diff.missingItems;
  if (limit && limit > 0) {
    itemsToSync = itemsToSync.slice(0, limit);
    console.log(`⚠️ Limiting sync to first ${itemsToSync.length} missing items.`);
  }

  // Generate Shopify import CSV file
  const outCsvContent = generateShopifyCsv(itemsToSync, status);
  const outCsvPath = path.resolve(process.cwd(), "..", "shopify_missing_products_import.csv");
  fs.writeFileSync(outCsvPath, outCsvContent, "utf-8");
  console.log(`\n📄 Exported ${itemsToSync.length} missing [${warehouseArg}] items to Shopify Import CSV:`);
  console.log(`   ${outCsvPath}`);

  if (dryRun) {
    console.log(`\n[Dry Run Summary] Missing items from [${warehouseArg}] warehouse:`);
    itemsToSync.slice(0, 20).forEach((item, index) => {
      console.log(` ${String(index + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(12)} | Name: ${item.name.padEnd(35)} | Price: ${item.rate}`);
    });
    if (itemsToSync.length > 20) {
      console.log(` ... and ${itemsToSync.length - 20} more missing items.`);
    }
    console.log("\n💡 Next Steps:");
    console.log(`   1) Direct Import: Upload '${path.basename(outCsvPath)}' in Shopify Admin (Products ➔ Import).`);
    console.log(`   2) App Dashboard: Open '/app/zoho-sync' in the Shopify App Admin interface.`);
    return;
  }
}

main().catch((err) => {
  console.error("\n💥 Error running sync-zoho-products:", err);
  process.exit(1);
});
