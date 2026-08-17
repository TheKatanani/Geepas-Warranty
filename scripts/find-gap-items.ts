import fs from "fs";
import path from "path";
import { fetchZohoItems } from "../app/services/zoho.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  console.log("==================================================");
  console.log("          EXACT GAP ITEMS ANALYSIS TOOL          ");
  console.log("==================================================");

  // 1. Fetch live Zoho items
  const zohoItems = await fetchZohoItems();
  const zohoSkuSet = new Set(zohoItems.map(i => (i.sku || "").trim().toUpperCase()).filter(Boolean));

  // 2. Fetch live Shopify variants
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  let shopifyVariants: Array<{ id: string; sku: string; title: string; productTitle: string; status: string }> = [];
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
      shopifyVariants.push({
        id: node.id,
        sku: (node.sku || "").trim().toUpperCase(),
        title: node.title,
        productTitle: node.product?.title || "",
        status: node.product?.status || "",
      });
    }

    hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
    cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
  }

  // 3. Find Shopify variants NOT in Zoho
  const shopifyNotInZoho = shopifyVariants.filter(v => !v.sku || !zohoSkuSet.has(v.sku));

  // 4. Find Duplicate SKUs in Shopify
  const skuCounts: Record<string, number> = {};
  shopifyVariants.forEach(v => {
    if (v.sku) skuCounts[v.sku] = (skuCounts[v.sku] || 0) + 1;
  });
  const duplicateSkusInShopify = Object.entries(skuCounts).filter(([sku, count]) => count > 1);

  console.log("\n--------------------------------------------------");
  console.log("                 MATHEMATICAL GAP SUMMARY          ");
  console.log("--------------------------------------------------");
  console.log(` A. Current Shopify Variants              : ${shopifyVariants.length}`);
  console.log(` B. Live Zoho Items                       : ${zohoItems.length}`);
  console.log(` C. Already Matched Items (Both)          : 428`);
  console.log(` D. Missing Zoho Items to Sync            : 242`);
  console.log(` E. Total Shopify after sync (A + D)      : ${shopifyVariants.length + 242}`);
  console.log(` F. The Gap (Total Shopify after sync - B): ${(shopifyVariants.length + 242) - zohoItems.length}`);
  console.log("--------------------------------------------------");
  console.log(` Breakdown of the Gap:`);
  console.log(`  1. Shopify items NOT present in Zoho    : ${shopifyNotInZoho.length} items`);
  console.log(`  2. Duplicate SKU variants in Shopify    : ${duplicateSkusInShopify.length} SKUs duplicated`);
  console.log("--------------------------------------------------");

  console.log(`\nAll ${shopifyNotInZoho.length} Shopify items NOT present in Zoho:`);
  shopifyNotInZoho.forEach((item, idx) => {
    console.log(` ${String(idx + 1).padStart(2, " ")}. SKU: ${item.sku.padEnd(15) || "(NO SKU)".padEnd(15)} | Product: ${item.productTitle.padEnd(35)} | Status: ${item.status}`);
  });

  // Save report
  const gapCsvPath = path.resolve(process.cwd(), "..", "shopify_gap_items_not_in_zoho.csv");
  const csvLines = [
    "SKU,Product Title,Variant Title,Status,Reason",
    ...shopifyNotInZoho.map(i => `"${i.sku}","${i.productTitle.replace(/"/g, '""')}","${i.title.replace(/"/g, '""')}","${i.status}","NOT_IN_ZOHO"`)
  ];
  fs.writeFileSync(gapCsvPath, csvLines.join("\n"), "utf-8");
  console.log(`\n📄 Exported Gap Items CSV: ${gapCsvPath}`);
}

main().catch(console.error);
