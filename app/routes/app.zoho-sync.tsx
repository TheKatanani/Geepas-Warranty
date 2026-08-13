import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  IndexTable,
  Banner,
  Select,
  TextField,
  ProgressBar,
  Box,
  Divider,
} from "@shopify/polaris";
import { useState } from "react";
import fs from "fs";
import path from "path";
import { authenticate } from "../shopify.server.js";
import { fetchZohoItems, parseZohoCsv, ZohoItem } from "../services/zoho.server.js";
import {
  fetchAllShopifyVariants,
  diffZohoAndShopify,
} from "../services/zoho-product-sync.server.js";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const warehouse = url.searchParams.get("warehouse") || "ZYN";

  let zohoItems: ZohoItem[] = [];
  const rootCsvPath = path.resolve(process.cwd(), "..", "Item.csv");
  const localCsvPath = path.resolve(process.cwd(), "Item.csv");
  const targetCsvPath = fs.existsSync(rootCsvPath) ? rootCsvPath : (fs.existsSync(localCsvPath) ? localCsvPath : null);

  if (targetCsvPath) {
    try {
      const csvData = fs.readFileSync(targetCsvPath, "utf-8");
      zohoItems = parseZohoCsv(csvData);
    } catch (e) {
      console.warn("Failed to parse local Item.csv, falling back to Zoho API:", e);
    }
  }

  if (zohoItems.length === 0) {
    try {
      zohoItems = await fetchZohoItems({ warehouseId: warehouse });
    } catch (e: any) {
      console.warn("Zoho API fetch failed:", e.message);
    }
  }

  let shopifyVariants: Array<{ sku: string; barcode?: string }> = [];
  const defaultShopifyCsv = path.resolve(process.cwd(), "..", "products_export.csv");
  const localShopifyCsv = path.resolve(process.cwd(), "products_export.csv");
  const shopifyCsvPath = fs.existsSync(defaultShopifyCsv) ? defaultShopifyCsv : (fs.existsSync(localShopifyCsv) ? localShopifyCsv : null);

  if (shopifyCsvPath) {
    shopifyVariants = parseShopifyCsvVariants(shopifyCsvPath);
  }

  const diff = diffZohoAndShopify(zohoItems, shopifyVariants, { warehouseFilter: warehouse });

  return json({
    warehouseFilter: warehouse,
    totalZohoItems: diff.totalZohoItems,
    filteredZohoItems: diff.filteredZohoItems,
    totalShopifyVariants: diff.totalShopifyVariants,
    matchedCount: diff.matchedCount,
    missingCount: diff.missingItems.length,
    missingItems: diff.missingItems.map(i => ({
      sku: i.sku,
      name: i.name,
      rate: i.rate,
      brand: i.brand || "GEEPAS",
      location_name: i.location_name || i.warehouse_name || warehouse,
      category_name: i.category_name || "General",
      stock_on_hand: i.stock_on_hand || 0,
    })),
    csvGeneratedPath: "shopify_missing_products_import.csv",
  });
};

export default function ZohoProductSyncPage() {
  const data = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<any>();

  const [warehouse, setWarehouse] = useState<string>(data.warehouseFilter || "ZYN");
  const [productStatus, setProductStatus] = useState<"ACTIVE" | "DRAFT">("ACTIVE");
  const [selectedLimit, setSelectedLimit] = useState<string>("all");

  const isSyncing = syncFetcher.state !== "idle";
  const syncResult = syncFetcher.data;

  const handleStartSync = () => {
    const limit = selectedLimit === "all" ? undefined : parseInt(selectedLimit, 10);
    syncFetcher.submit(
      JSON.stringify({
        warehouse,
        status: productStatus,
        limit,
      }),
      {
        method: "POST",
        action: "/api/zoho-product-sync",
        encType: "application/json",
      }
    );
  };

  return (
    <Page
      title="Zoho ➔ Shopify Product Sync"
      subtitle={`Warehouse Specific Sync [Filter: ${warehouse}]`}
      compactTitle
    >
      <BlockStack gap="500">
        <Banner title="ZYN Warehouse Product Import" tone="info">
          <p>
            Filtering active items strictly for the <strong>{warehouse} Warehouse</strong>. Only items belonging to {warehouse} will be scanned and created in Shopify.
          </p>
        </Banner>

        <Layout>
          <Layout.Section width="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Total Zoho Items</Text>
                <Text as="p" variant="headingLg">{data.totalZohoItems}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section width="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">{warehouse} Warehouse Items</Text>
                <InlineStack align="space-between">
                  <Text as="p" variant="headingLg">{data.filteredZohoItems}</Text>
                  <Badge tone="attention">Filtered by {warehouse}</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section width="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Missing in Shopify ({warehouse})</Text>
                <InlineStack align="space-between">
                  <Text as="p" variant="headingLg" tone="critical">{data.missingCount}</Text>
                  <Badge tone="critical">Needs Import</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Warehouse Filter & Action Controls</Text>
            <Divider />

            <InlineStack gap="400" align="start">
              <Box width="180px">
                <TextField
                  label="Warehouse Filter Code"
                  value={warehouse}
                  onChange={(val) => setWarehouse(val)}
                  autoComplete="off"
                  helpText="Default: ZYN"
                />
              </Box>

              <Box width="200px">
                <Select
                  label="Product Status in Shopify"
                  options={[
                    { label: "Active (Visible in Store)", value: "ACTIVE" },
                    { label: "Draft (Review first)", value: "DRAFT" },
                  ]}
                  value={productStatus}
                  onChange={(val) => setProductStatus(val as "ACTIVE" | "DRAFT")}
                />
              </Box>

              <Box width="200px">
                <Select
                  label="Import Batch Limit"
                  options={[
                    { label: `Sync All ${data.missingCount} Items`, value: "all" },
                    { label: "First 10 Items (Test)", value: "10" },
                    { label: "First 50 Items", value: "50" },
                    { label: "First 100 Items", value: "100" },
                  ]}
                  value={selectedLimit}
                  onChange={(val) => setSelectedLimit(val)}
                />
              </Box>
            </InlineStack>

            <InlineStack gap="300">
              <Button
                variant="primary"
                loading={isSyncing}
                onClick={handleStartSync}
              >
                Sync {warehouse} Missing Items to Shopify
              </Button>
            </InlineStack>

            {isSyncing && (
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">Creating {warehouse} products in Shopify Admin API...</Text>
                <ProgressBar progress={50} animated />
              </BlockStack>
            )}

            {syncResult?.success && (
              <Banner title="Sync Completed Successfully" tone="success">
                <p>Created: {syncResult.createdCount} products in Shopify for warehouse {syncResult.warehouseFilter}.</p>
                {syncResult.failedCount > 0 && (
                  <p>Failed: {syncResult.failedCount} items (check logs for details).</p>
                )}
              </Banner>
            )}
          </BlockStack>
        </Card>

        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{warehouse} Missing Items ({data.missingItems.length})</Text>
              <Badge tone="info">File Export Ready: {data.csvGeneratedPath}</Badge>
            </InlineStack>
          </Box>
          <IndexTable
            resourceName={{ singular: "item", plural: "items" }}
            itemCount={data.missingItems.length}
            selectable={false}
            headings={[
              { title: "SKU" },
              { title: "Item Name" },
              { title: "Location / Warehouse" },
              { title: "Brand" },
              { title: "Price (IQD)" },
              { title: "Stock Qty" },
            ]}
          >
            {data.missingItems.slice(0, 100).map((item, index) => (
              <IndexTable.Row id={item.sku || String(index)} key={item.sku || index} position={index}>
                <IndexTable.Cell>
                  <Text variant="bodyMd" fontWeight="bold">{item.sku}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{item.name}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="attention">{item.location_name}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{item.brand}</IndexTable.Cell>
                <IndexTable.Cell>{item.rate.toLocaleString()} IQD</IndexTable.Cell>
                <IndexTable.Cell>{item.stock_on_hand}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
