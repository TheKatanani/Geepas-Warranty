import { unauthenticated } from "../app/shopify.server.js";

interface VariantInfo {
  variantId: string;
  variantTitle: string;
  productId: string;
  productTitle: string;
  productStatus: string;
  price: string;
  sku: string;
}

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  console.log(`[Audit] Scanning Shopify store (${shop}) for duplicate SKUs...\n`);

  const { admin } = await unauthenticated.admin(shop);

  const skuMap = new Map<string, VariantInfo[]>();
  let hasNextPage = true;
  let cursor: string | null = null;
  let totalProducts = 0;
  let totalVariants = 0;

  const query = `#graphql
    query getCatalogForSkuDuplicates($cursor: String) {
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
              price
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const res: any = await admin.graphql(query, { variables: { cursor } });
    const json = await res.json();
    const products = json?.data?.products?.nodes || [];

    for (const p of products) {
      totalProducts++;
      for (const v of p.variants?.nodes || []) {
        totalVariants++;
        const sku = (v.sku || "").trim().toUpperCase();
        if (!sku) continue;

        if (!skuMap.has(sku)) {
          skuMap.set(sku, []);
        }
        skuMap.get(sku)!.push({
          variantId: v.id,
          variantTitle: v.title,
          productId: p.id,
          productTitle: p.title,
          productStatus: p.status,
          price: v.price,
          sku,
        });
      }
    }

    hasNextPage = Boolean(json?.data?.products?.pageInfo?.hasNextPage);
    cursor = json?.data?.products?.pageInfo?.endCursor || null;
  }

  // Analyze duplicates
  const duplicates = Array.from(skuMap.entries()).filter(([_, variants]) => variants.length > 1);

  console.log("=================================================");
  console.log("             DUPLICATE SKU AUDIT REPORT          ");
  console.log("=================================================");
  console.log(`Total Products Scanned   : ${totalProducts}`);
  console.log(`Total Variants Scanned   : ${totalVariants}`);
  console.log(`Total Unique SKUs        : ${skuMap.size}`);
  console.log(`SKUs with Duplicates     : ${duplicates.length}\n`);

  let sameProductDuplicates = 0;
  let crossProductDuplicates = 0;

  const details: any[] = [];

  for (const [sku, variants] of duplicates) {
    const uniqueProductIds = new Set(variants.map((v) => v.productId));
    const isSameProduct = uniqueProductIds.size === 1;

    if (isSameProduct) {
      sameProductDuplicates++;
    } else {
      crossProductDuplicates++;
    }

    details.push({
      sku,
      type: isSameProduct ? "MULTI_VARIANT_SAME_PRODUCT (e.g. Warranty)" : "CROSS_PRODUCT_DUPLICATE (Separate Products)",
      instances: variants.length,
      variants: variants.map((v) => ({
        productTitle: v.productTitle,
        status: v.productStatus,
        variantTitle: v.variantTitle,
        price: v.price,
        productId: v.productId,
      })),
    });
  }

  const statusCombos: Record<string, number> = {};
  for (const [sku, variants] of duplicates) {
    const statuses = variants.map((v) => v.productStatus).sort().join(" + ");
    statusCombos[statuses] = (statusCombos[statuses] || 0) + 1;
  }

  console.log("Status Breakdown of the 35 Duplicate SKUs:");
  for (const [combo, count] of Object.entries(statusCombos)) {
    console.log(`  • [${combo}]: ${count} SKUs`);
  }
  console.log("");

  console.log("Full List of All 35 Duplicate SKUs:");
  details.forEach((d, i) => {
    const statusSummary = d.variants.map((v: any) => `[${v.status}] "${v.productTitle.slice(0, 35)}"`).join(" vs ");
    console.log(`  ${(i + 1).toString().padStart(2)}. SKU: ${d.sku.padEnd(12)} -> ${statusSummary}`);
  });
}

main().catch(console.error);
