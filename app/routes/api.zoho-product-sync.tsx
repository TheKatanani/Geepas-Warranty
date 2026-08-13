import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import fs from "fs";
import path from "path";
import { authenticate } from "../shopify.server.js";
import { fetchZohoItems, parseZohoCsv, ZohoItem } from "../services/zoho.server.js";
import {
  fetchAllShopifyVariants,
  diffZohoAndShopify,
  createShopifyProductFromZoho,
} from "../services/zoho-product-sync.server.js";

async function loadZohoItems(warehouseFilter?: string): Promise<ZohoItem[]> {
  const rootCsvPath = path.resolve(process.cwd(), "..", "Item.csv");
  const localCsvPath = path.resolve(process.cwd(), "Item.csv");
  const targetPath = fs.existsSync(rootCsvPath) ? rootCsvPath : (fs.existsSync(localCsvPath) ? localCsvPath : null);

  if (targetPath) {
    try {
      const csvData = fs.readFileSync(targetPath, "utf-8");
      return parseZohoCsv(csvData);
    } catch (e) {
      console.warn("[api.zoho-product-sync] CSV load failed, falling back to Zoho API:", e);
    }
  }

  return fetchZohoItems({ warehouseId: warehouseFilter });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const warehouse = url.searchParams.get("warehouse") || "ZYN";

  try {
    const zohoItems = await loadZohoItems(warehouse);
    const shopifyVariants = await fetchAllShopifyVariants(admin);
    const diff = diffZohoAndShopify(zohoItems, shopifyVariants, { warehouseFilter: warehouse });

    return json({
      success: true,
      warehouseFilter: warehouse,
      totalZohoItems: diff.totalZohoItems,
      filteredZohoItems: diff.filteredZohoItems,
      totalShopifyVariants: diff.totalShopifyVariants,
      matchedCount: diff.matchedCount,
      missingCount: diff.missingItems.length,
      missingItemsPreview: diff.missingItems.slice(0, 50).map((item) => ({
        sku: item.sku,
        name: item.name,
        rate: item.rate,
        brand: item.brand,
        location_name: item.location_name || item.warehouse_name,
        stock_on_hand: item.stock_on_hand,
      })),
    });
  } catch (err: any) {
    return json({ success: false, error: err.message || String(err) }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));

  const warehouse = typeof body.warehouse === "string" ? body.warehouse : "ZYN";
  const status = (body.status === "DRAFT" ? "DRAFT" : "ACTIVE") as "ACTIVE" | "DRAFT";
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : undefined;
  const selectedSkus: string[] | undefined = Array.isArray(body.skus) ? body.skus : undefined;

  try {
    let zohoItems = await loadZohoItems(warehouse);

    if (selectedSkus && selectedSkus.length > 0) {
      const skuSet = new Set(selectedSkus.map((s) => s.trim().toUpperCase()));
      zohoItems = zohoItems.filter((item) => skuSet.has(item.sku.trim().toUpperCase()));
    }

    const shopifyVariants = await fetchAllShopifyVariants(admin);
    const diff = diffZohoAndShopify(zohoItems, shopifyVariants, { warehouseFilter: warehouse });

    let toProcess = diff.missingItems;
    if (limit && limit > 0) {
      toProcess = toProcess.slice(0, limit);
    }

    const createdItems: Array<{ sku: string; shopifyProductId: string; title: string }> = [];
    const errors: Array<{ sku: string; error: string }> = [];

    for (const item of toProcess) {
      const res = await createShopifyProductFromZoho(admin, item, { status });
      if (res.success && res.shopifyProductId) {
        createdItems.push({
          sku: item.sku,
          shopifyProductId: res.shopifyProductId,
          title: item.name,
        });
      } else {
        errors.push({
          sku: item.sku || item.name,
          error: res.error || "Creation failed",
        });
      }
    }

    return json({
      success: true,
      warehouseFilter: warehouse,
      scannedTotal: diff.totalZohoItems,
      filteredTotal: diff.filteredZohoItems,
      missingCount: diff.missingItems.length,
      processedCount: toProcess.length,
      createdCount: createdItems.length,
      failedCount: errors.length,
      createdItems,
      errors,
    });
  } catch (err: any) {
    return json({ success: false, error: err.message || String(err) }, { status: 500 });
  }
};
