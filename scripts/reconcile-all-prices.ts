import fs from "fs";
import path from "path";
import { fetchZohoItems, parseZohoCsv } from "../app/services/zoho.server.js";
import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("==================================================");
  console.log("   UPDATING ALL SHOPIFY PRODUCT PRICES FROM ZOHO  ");
  console.log("==================================================");

  // 1. Fetch Live Zoho Items
  const zohoItems = await fetchZohoItems();
  const zohoMap = new Map<string, typeof zohoItems[0]>();
  zohoItems.forEach(i => {
    if (i.sku) zohoMap.set(i.sku.trim().toUpperCase(), i);
  });

  // 2. Fetch Live Shopify Variants
  console.log(`[Shopify API] Fetching all live variants from ${shop}...`);
  let shopifyVariants: Array<{ id: string; productId: string; sku: string; price: string }> = [];

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
          product {
            id
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
      if (node.sku && node.product?.id) {
        shopifyVariants.push({
          id: node.id,
          productId: node.product.id,
          sku: node.sku.trim().toUpperCase(),
          price: node.price,
        });
      }
    }

    hasNextPage = Boolean(json.data?.productVariants?.pageInfo?.hasNextPage);
    cursor = json.data?.productVariants?.pageInfo?.endCursor || null;
  }

  console.log(`Loaded ${shopifyVariants.length} Shopify variants.`);

  // 3. Group variants by Product ID for bulk update
  const productVariantGroups = new Map<string, Array<{ id: string; price: string }>>();

  for (const variant of shopifyVariants) {
    const zohoItem = zohoMap.get(variant.sku);
    if (zohoItem && zohoItem.rate > 0) {
      const currentPrice = parseFloat(variant.price) || 0;
      if (Math.abs(currentPrice - zohoItem.rate) > 0.01) {
        const priceStr = zohoItem.rate.toString();
        if (!productVariantGroups.has(variant.productId)) {
          productVariantGroups.set(variant.productId, []);
        }
        productVariantGroups.get(variant.productId)!.push({
          id: variant.id,
          price: priceStr,
        });
      }
    }
  }

  console.log(`Found ${productVariantGroups.size} products needing price updates.`);

  const bulkMutation = `#graphql
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          price
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  let updatedVariantCount = 0;
  let errorCount = 0;

  let index = 0;
  for (const [productId, variants] of productVariantGroups.entries()) {
    index++;
    try {
      const res: any = await admin.graphql(bulkMutation, {
        variables: { productId, variants },
      });
      const resJson: any = await res.json();
      const userErrors = resJson.data?.productVariantsBulkUpdate?.userErrors || [];

      if (userErrors.length === 0) {
        updatedVariantCount += variants.length;
        if (index <= 10 || index % 50 === 0) {
          console.log(`[${index}/${productVariantGroups.size}] Updated prices for product ${productId} (${variants.length} variant/s)`);
        }
      } else {
        console.error(`Error updating product ${productId}:`, userErrors);
        errorCount++;
      }
    } catch (e: any) {
      console.error(`Exception updating product ${productId}:`, e.message);
      errorCount++;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log("\n==================================================");
  console.log("          PRICE RECONCILIATION COMPLETE           ");
  console.log("==================================================");
  console.log(` Products Processed        : ${productVariantGroups.size}`);
  console.log(` Variant Prices Updated   : ${updatedVariantCount}`);
  console.log(` Errors                    : ${errorCount}`);
  console.log("==================================================");
}

main().catch(console.error);
