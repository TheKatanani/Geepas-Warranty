import { fetchZohoItems, ZohoItem } from "./zoho.server.js";

export interface SyncOptions {
  status?: "ACTIVE" | "DRAFT";
  maxLimit?: number;
  dryRun?: boolean;
  warehouseFilter?: string;
}

export interface SyncDiffResult {
  totalZohoItems: number;
  filteredZohoItems: number;
  totalShopifyVariants: number;
  matchedCount: number;
  missingItems: ZohoItem[];
}

export interface SyncExecutionResult {
  totalScanned: number;
  missingCount: number;
  createdCount: number;
  failedCount: number;
  errors: Array<{ sku: string; error: string }>;
  createdItems: Array<{ sku: string; shopifyProductId: string; title: string }>;
}

/**
 * Fetches all product variants from Shopify GraphQL Admin API.
 */
export async function fetchAllShopifyVariants(admin: any): Promise<Array<{ id: string; sku: string; barcode?: string; productId: string }>> {
  const variants: Array<{ id: string; sku: string; barcode?: string; productId: string }> = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const query = `#graphql
    query getProductVariants($cursor: String) {
      productVariants(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            sku
            barcode
            product {
              id
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await admin.graphql(query, {
      variables: { cursor },
    });

    const json = await response.json();
    const data = json.data?.productVariants;
    if (!data) break;

    for (const edge of data.edges || []) {
      const node = edge.node;
      if (node) {
        variants.push({
          id: node.id,
          sku: (node.sku || "").trim(),
          barcode: (node.barcode || "").trim(),
          productId: node.product?.id || "",
        });
      }
    }

    hasNextPage = Boolean(data.pageInfo?.hasNextPage);
    cursor = data.pageInfo?.endCursor || null;
  }

  return variants;
}

/**
 * Compares Zoho items against existing Shopify variants by SKU.
 * Optionally filters Zoho items by warehouse (e.g. "ZYN").
 */
export function diffZohoAndShopify(
  zohoItems: ZohoItem[],
  shopifyVariants: Array<{ sku: string; barcode?: string }>,
  options: { warehouseFilter?: string } = {}
): SyncDiffResult {
  const filter = options.warehouseFilter?.trim().toUpperCase();

  // Filter items by warehouse if specified
  const filteredItems = filter
    ? zohoItems.filter(item => {
        const loc = (item.location_name || item.warehouse_name || "").toUpperCase();
        // If location is specified, match against filter; if missing, keep for safety or match ZYN
        return loc ? loc.includes(filter) : true;
      })
    : zohoItems;

  const shopifySkus = new Set(
    shopifyVariants
      .map(v => v.sku ? v.sku.trim().toUpperCase() : "")
      .filter(Boolean)
  );

  const missingItems: ZohoItem[] = [];
  let matchedCount = 0;

  for (const item of filteredItems) {
    const sku = item.sku ? item.sku.trim().toUpperCase() : "";
    if (sku && shopifySkus.has(sku)) {
      matchedCount++;
    } else {
      missingItems.push(item);
    }
  }

  return {
    totalZohoItems: zohoItems.length,
    filteredZohoItems: filteredItems.length,
    totalShopifyVariants: shopifyVariants.length,
    matchedCount,
    missingItems,
  };
}


/**
 * Creates a single missing Zoho product in Shopify via Admin GraphQL API.
 */
export async function createShopifyProductFromZoho(
  admin: any,
  item: ZohoItem,
  options: { status?: "ACTIVE" | "DRAFT" } = {}
): Promise<{ success: boolean; shopifyProductId?: string; error?: string }> {
  const status = options.status || "ACTIVE";
  const title = item.name.trim() || item.sku.trim();
  const sku = item.sku.trim();
  const priceStr = Math.max(0, item.rate).toString();
  const descriptionHtml = item.description
    ? `<p>${item.description.replace(/\n/g, "<br/>")}</p>`
    : `<p>${title}</p>`;

  const mutation = `#graphql
    mutation createProductWithVariant($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          handle
          status
          variants(first: 5) {
            edges {
              node {
                id
                sku
                price
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const input = {
    title,
    vendor: item.brand || "GEEPAS",
    productType: item.category_name || "General",
    descriptionHtml,
    status,
    variants: [
      {
        sku: sku,
        price: priceStr,
        barcode: item.upc || item.ean || sku,
      },
    ],
  };

  try {
    const response = await admin.graphql(mutation, {
      variables: { input },
    });

    const json = await response.json();
    const userErrors = json.data?.productCreate?.userErrors;

    if (userErrors && userErrors.length > 0) {
      const errMsg = userErrors.map((e: any) => `${e.field?.join(".") || "error"}: ${e.message}`).join(", ");
      return { success: false, error: errMsg };
    }

    const createdProduct = json.data?.productCreate?.product;
    if (!createdProduct?.id) {
      return { success: false, error: "Product creation failed without explicit errors" };
    }

    return {
      success: true,
      shopifyProductId: createdProduct.id,
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Main orchestration function: fetches Zoho items, diffs against Shopify, and creates missing ones.
 */
export async function syncZohoProductsToShopify(
  admin: any,
  customZohoItems?: ZohoItem[],
  options: SyncOptions = {}
): Promise<SyncExecutionResult> {
  const status = options.status || "ACTIVE";
  const dryRun = options.dryRun ?? false;

  // 1. Fetch Zoho Items
  const zohoItems = customZohoItems && customZohoItems.length > 0
    ? customZohoItems
    : await fetchZohoItems();

  // 2. Fetch Shopify Variants
  const shopifyVariants = await fetchAllShopifyVariants(admin);

  // 3. Diff
  const diff = diffZohoAndShopify(zohoItems, shopifyVariants, { warehouseFilter: options.warehouseFilter });

  let toProcess = diff.missingItems;
  if (options.maxLimit && options.maxLimit > 0) {
    toProcess = toProcess.slice(0, options.maxLimit);
  }

  const result: SyncExecutionResult = {
    totalScanned: diff.totalZohoItems,
    missingCount: diff.missingItems.length,
    createdCount: 0,
    failedCount: 0,
    errors: [],
    createdItems: [],
  };

  if (dryRun) {
    return result;
  }

  // 4. Create missing items
  for (const item of toProcess) {
    const res = await createShopifyProductFromZoho(admin, item, { status });
    if (res.success && res.shopifyProductId) {
      result.createdCount++;
      result.createdItems.push({
        sku: item.sku,
        shopifyProductId: res.shopifyProductId,
        title: item.name,
      });
    } else {
      result.failedCount++;
      result.errors.push({
        sku: item.sku || item.name,
        error: res.error || "Unknown error",
      });
    }
  }

  return result;
}
