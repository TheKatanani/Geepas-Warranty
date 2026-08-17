/**
 * Idempotent One-Off & Maintenance Script: Fix Untracked Inventory for Bulk-Created Products
 *
 * Scopes to newly created gap-fill draft products in Shopify:
 *   1. Queries variants where inventoryItem.tracked == false (or unscoped in target query)
 *   2. Sets `tracked: true` on the InventoryItem
 *   3. Activates the InventoryItem at the specified location (default: "zayouna") with `available: 0`
 *   4. Skips already tracked / activated items idempotently
 *   5. Logs results to a timestamped file and prints a comprehensive terminal summary
 *
 * Usage:
 *   pnpm fix-untracked-inventory [--dry-run] [--limit=5] [--shop=store.myshopify.com] [--token=shpat_...] [--location-name=zayouna] [--location-id=gid://shopify/Location/...]
 */

import fs from "fs";
import path from "path";
import prisma from "../app/db.server.js";
import { unauthenticated } from "../app/shopify.server.js";

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");

let limitParam = 0;
const limitArg = args.find((a) => a.startsWith("--limit="));
if (limitArg) {
  limitParam = parseInt(limitArg.split("=")[1], 10) || 0;
} else {
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limitParam = parseInt(args[limitIdx + 1], 10) || 0;
  }
}

let shopParam = process.env.SHOP || process.env.SHOP_CUSTOM_DOMAIN || "ae53cd-2.myshopify.com";
const shopArg = args.find((a) => a.startsWith("--shop="));
if (shopArg) {
  shopParam = shopArg.split("=")[1];
}

const tokenArg = args.find((a) => a.startsWith("--token="));
const cliToken = tokenArg
  ? tokenArg.split("=")[1]
  : (process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "");

let targetLocationName = "zayouna";
const locNameArg = args.find((a) => a.startsWith("--location-name="));
if (locNameArg) {
  targetLocationName = locNameArg.split("=")[1];
}

let explicitLocationId = "";
const locIdArg = args.find((a) => a.startsWith("--location-id="));
if (locIdArg) {
  explicitLocationId = locIdArg.split("=")[1];
} else if (process.env.SHOPIFY_LOCATION_ID) {
  explicitLocationId = process.env.SHOPIFY_LOCATION_ID;
}

let productQuery = "status:DRAFT";
const queryArg = args.find((a) => a.startsWith("--query="));
if (queryArg) {
  productQuery = queryArg.split("=")[1];
} else {
  const qIdx = args.indexOf("--query");
  if (qIdx !== -1 && args[qIdx + 1]) {
    productQuery = args[qIdx + 1];
  }
}

const createdAfterArg = args.find((a) => a.startsWith("--created-after="));
if (createdAfterArg) {
  const dateStr = createdAfterArg.split("=")[1];
  productQuery += ` created_at:>=${dateStr}`;
} else {
  const caIdx = args.indexOf("--created-after");
  if (caIdx !== -1 && args[caIdx + 1]) {
    productQuery += ` created_at:>=${args[caIdx + 1]}`;
  }
}

// ---------------------------------------------------------------------------
// Types & Log Data Structure
// ---------------------------------------------------------------------------

export interface LogEntry {
  productId: string;
  productTitle: string;
  variantId: string;
  sku: string;
  previousTracked: boolean;
  newTracked: boolean;
  locationActivated: boolean;
  locationId: string;
  locationName: string;
  timestamp: string;
  status: "success" | "skipped" | "failed";
  errorMessage?: string;
}

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  inventoryItem: {
    id: string;
    tracked: boolean;
    inventoryLevels?: {
      nodes: Array<{
        id: string;
        location: {
          id: string;
          name: string;
        };
        quantities?: Array<{
          name: string;
          quantity: number;
        }>;
      }>;
    };
  } | null;
}

interface ProductNode {
  id: string;
  title: string;
  status: string;
  vendor: string;
  createdAt: string;
  variants: {
    nodes: VariantNode[];
  };
}

// ---------------------------------------------------------------------------
// GraphQL Client & Queries
// ---------------------------------------------------------------------------

class ShopifyGqlExecutor {
  private cleanShop: string;
  private token: string;
  private remixAdmin: any;

  constructor(shop: string, token: string, remixAdmin?: any) {
    this.cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.token = token;
    this.remixAdmin = remixAdmin;
  }

  async request(query: string, variables: Record<string, any> = {}): Promise<any> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (this.token) {
          const endpoint = `https://${this.cleanShop}/admin/api/2025-01/graphql.json`;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": this.token,
            },
            body: JSON.stringify({ query, variables }),
          });

          if (res.status === 429) {
            const retryAfter = parseFloat(res.headers.get("Retry-After") || "2");
            console.warn(`[Rate Limited] 429 received. Waiting ${retryAfter}s (attempt ${attempt}/${maxRetries})...`);
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
          }

          const json = await res.json();

          // Check for throttle cost
          const throttle = json.extensions?.cost?.throttleStatus;
          if (throttle && throttle.currentlyAvailable < 300) {
            const sleepMs = Math.ceil((300 - throttle.currentlyAvailable) / (throttle.restoreRate || 50)) * 1000;
            await new Promise((r) => setTimeout(r, Math.min(sleepMs, 3000)));
          }

          return json;
        } else if (this.remixAdmin) {
          try {
            const res: any = await this.remixAdmin.graphql(query, { variables });
            const json = await res.json();
            return json;
          } catch (gqlErr: any) {
            return {
              errors: gqlErr.graphQLErrors || [{ message: gqlErr.message || String(gqlErr) }],
            };
          }
        } else {
          throw new Error("No valid Shopify Admin API client or token available.");
        }
      } catch (err: any) {
        if (attempt < maxRetries && (err.message?.includes("fetch") || err.message?.includes("timeout") || err.message?.includes("Throttled"))) {
          console.warn(`[Network / API Retry] Attempt ${attempt} failed: ${err.message}. Retrying in 1.5s...`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return {
          errors: [{ message: err.message || String(err) }],
        };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GraphQL Queries & Mutations
// ---------------------------------------------------------------------------

const GET_LOCATIONS_QUERY = `#graphql
  query getLocations {
    locations(first: 50) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

const GET_UNTRACKED_PRODUCTS_QUERY = `#graphql
  query getUntrackedProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        vendor
        createdAt
        variants(first: 50) {
          nodes {
            id
            title
            sku
            inventoryItem {
              id
              tracked
            }
          }
        }
      }
    }
  }
`;

const GET_UNTRACKED_PRODUCTS_WITH_LEVELS_QUERY = `#graphql
  query getUntrackedProductsWithLevels($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        vendor
        createdAt
        variants(first: 50) {
          nodes {
            id
            title
            sku
            inventoryItem {
              id
              tracked
              inventoryLevels(first: 10) {
                nodes {
                  id
                  location {
                    id
                    name
                  }
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const INVENTORY_ITEM_UPDATE_MUTATION = `#graphql
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        tracked
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        inventoryItem {
          id
          tracked
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_ACTIVATE_MUTATION = `#graphql
  mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
      inventoryLevel {
        id
        quantities(names: ["available"]) {
          name
          quantity
        }
        item {
          id
          tracked
        }
        location {
          id
          name
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helper: Resolve Target Location
// ---------------------------------------------------------------------------

async function resolveLocation(
  client: ShopifyGqlExecutor,
  explicitId: string,
  targetName: string
): Promise<{ id: string; name: string }> {
  if (explicitId) {
    const formattedId = explicitId.startsWith("gid://shopify/Location/")
      ? explicitId
      : `gid://shopify/Location/${explicitId}`;
    return { id: formattedId, name: targetName || "zayouna" };
  }

  console.log(`[Location Discovery] Querying active Shopify locations to find "${targetName}"...`);
  try {
    const res = await client.request(GET_LOCATIONS_QUERY);
    const locations = res?.data?.locations?.nodes || [];

    if (locations.length === 0) {
      if (res?.errors) {
        console.warn(`[Location Query Warning] GraphQL error: ${JSON.stringify(res.errors)}`);
      }
    } else {
      console.log(`[Location Discovery] Found ${locations.length} location(s):`);
      for (const loc of locations) {
        console.log(`   - ${loc.name} (${loc.id}) [Active: ${loc.isActive}]`);
      }

      // 1. Exact case-insensitive match
      const exact = locations.find(
        (l: any) => l.name.trim().toLowerCase() === targetName.trim().toLowerCase() && l.isActive
      );
      if (exact) {
        console.log(`🎯 Matched Location: "${exact.name}" (${exact.id})\n`);
        return { id: exact.id, name: exact.name };
      }

      // 2. Partial match
      const partial = locations.find(
        (l: any) => l.name.toLowerCase().includes(targetName.toLowerCase()) && l.isActive
      );
      if (partial) {
        console.log(`🎯 Matched Location (partial): "${partial.name}" (${partial.id})\n`);
        return { id: partial.id, name: partial.name };
      }
    }
  } catch (err: any) {
    console.warn(`[Location Query Note] Could not query locations: ${err.message}`);
  }

  // If could not dynamically resolve, prompt or check common defaults
  throw new Error(
    `Could not automatically resolve Location ID for "${targetName}". Please provide --location-id=gid://shopify/Location/<ID> or ensure your token has read_locations scope.`
  );
}

// ---------------------------------------------------------------------------
// Main Processing Function
// ---------------------------------------------------------------------------

export async function processVariantInventory(
  client: ShopifyGqlExecutor,
  product: ProductNode,
  variant: VariantNode,
  targetLocation: { id: string; name: string },
  dryRun: boolean
): Promise<LogEntry> {
  const timestamp = new Date().toISOString();
  const entry: LogEntry = {
    productId: product.id,
    productTitle: product.title,
    variantId: variant.id,
    sku: variant.sku || "",
    previousTracked: variant.inventoryItem?.tracked ?? false,
    newTracked: variant.inventoryItem?.tracked ?? false,
    locationActivated: false,
    locationId: targetLocation.id,
    locationName: targetLocation.name,
    timestamp,
    status: "success",
  };

  if (!variant.inventoryItem) {
    entry.status = "failed";
    entry.errorMessage = "Variant has no InventoryItem";
    return entry;
  }

  const inventoryItemId = variant.inventoryItem.id;

  // Check if already active at location
  const existingLevels = variant.inventoryItem.inventoryLevels?.nodes || [];
  const alreadyAtLocation = existingLevels.some(
    (lvl) => lvl.location?.id === targetLocation.id || lvl.location?.name.toLowerCase() === targetLocation.name.toLowerCase()
  );

  // If already tracked and already active at location, skip
  if (variant.inventoryItem.tracked && alreadyAtLocation) {
    entry.status = "skipped";
    entry.locationActivated = true;
    return entry;
  }

  if (dryRun) {
    if (!variant.inventoryItem.tracked) {
      entry.newTracked = true;
    }
    if (!alreadyAtLocation) {
      entry.locationActivated = true;
    }
    entry.status = "success";
    return entry;
  }

  // Step 1: Enable Tracking if untracked
  if (!variant.inventoryItem.tracked) {
    try {
      // Try inventoryItemUpdate first
      const itemUpdateRes = await client.request(INVENTORY_ITEM_UPDATE_MUTATION, {
        id: inventoryItemId,
        input: { tracked: true },
      });

      const itemErrors = itemUpdateRes?.data?.inventoryItemUpdate?.userErrors || [];
      if (itemErrors.length > 0) {
        throw new Error(itemErrors.map((e: any) => `${e.field}: ${e.message}`).join(", "));
      }

      if (itemUpdateRes?.errors && itemUpdateRes.errors.length > 0) {
        // Fallback: Try productVariantsBulkUpdate if inventoryItemUpdate had access denied
        const bulkUpdateRes = await client.request(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
          productId: product.id,
          variants: [
            {
              id: variant.id,
              inventoryItem: { tracked: true },
            },
          ],
        });

        const bulkErrors = bulkUpdateRes?.data?.productVariantsBulkUpdate?.userErrors || [];
        if (bulkErrors.length > 0) {
          throw new Error(bulkErrors.map((e: any) => `${e.field}: ${e.message}`).join(", "));
        }
      }

      entry.newTracked = true;
    } catch (err: any) {
      entry.status = "failed";
      entry.errorMessage = `Failed to enable tracking: ${err.message}`;
      return entry;
    }
  } else {
    entry.newTracked = true;
  }

  // Step 2: Activate at target Location
  if (!alreadyAtLocation) {
    try {
      const actRes = await client.request(INVENTORY_ACTIVATE_MUTATION, {
        inventoryItemId,
        locationId: targetLocation.id,
        available: 0, // Explicitly 0 starting quantity
      });

      const userErrors = actRes?.data?.inventoryActivate?.userErrors || [];
      if (userErrors.length > 0) {
        const errStr = userErrors.map((e: any) => e.message).join(", ");
        if (errStr.toLowerCase().includes("already activated") || errStr.toLowerCase().includes("already stocked")) {
          // Idempotent success / skip
          entry.locationActivated = true;
        } else {
          throw new Error(errStr);
        }
      } else if (actRes?.errors && actRes.errors.length > 0) {
        throw new Error(actRes.errors.map((e: any) => e.message).join(", "));
      } else {
        entry.locationActivated = true;
      }
    } catch (err: any) {
      entry.status = "failed";
      entry.errorMessage = `Failed to activate at location ${targetLocation.name}: ${err.message}`;
      return entry;
    }
  } else {
    entry.locationActivated = true;
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------

async function main() {
  const cleanShop = shopParam.replace(/^https?:\/\//, "").replace(/\/$/, "");

  console.log("=================================================================");
  console.log("    SHOPIFY UNTRACKED INVENTORY FIX & LOCATION ACTIVATION TOOL   ");
  console.log("=================================================================");
  console.log(` Target Shop      : ${cleanShop}`);
  console.log(` Execution Mode   : ${IS_DRY_RUN ? "🔍 DRY RUN (Preview Only)" : "🚀 LIVE COMMITS (Mutations Enabled)"}`);
  console.log(` Target Location  : "${targetLocationName}" ${explicitLocationId ? `(${explicitLocationId})` : "(Auto-discovery)"}`);
  console.log(` Product Scope    : query="${productQuery}"`);
  console.log(` Max Limit        : ${limitParam > 0 ? `${limitParam} variants max` : "All matching variants"}`);
  console.log("=================================================================\n");

  // 1. Establish Authentication
  let clientToken = cliToken;
  let remixAdmin: any = null;

  if (!clientToken) {
    console.log(`[Auth] Initializing Shopify Admin API client for ${cleanShop}...`);
    try {
      const unauth = await unauthenticated.admin(cleanShop);
      remixAdmin = unauth.admin;
    } catch (err: any) {
      console.warn(`[Auth Warning] Could not init unauthenticated admin: ${err.message}`);
    }
  }

  const gqlExecutor = new ShopifyGqlExecutor(cleanShop, clientToken, remixAdmin);

  // 2. Resolve Target Location
  let targetLocation: { id: string; name: string };
  try {
    targetLocation = await resolveLocation(gqlExecutor, explicitLocationId, targetLocationName);
  } catch (err: any) {
    console.error(`❌ Location Resolution Error: ${err.message}`);
    process.exit(1);
  }

  // 3. Query Scoped Products and Variants
  console.log(`[Products Query] Scanning Shopify products matching [${productQuery}]...`);

  let hasNextPage = true;
  let cursor: string | null = null;
  let scannedProducts = 0;
  let candidateVariants: Array<{ product: ProductNode; variant: VariantNode }> = [];

  // Determine if inventoryLevels can be included in query
  let useLevelsInQuery = true;

  while (hasNextPage) {
    const fetchSize = 50;
    const queryToUse = useLevelsInQuery ? GET_UNTRACKED_PRODUCTS_WITH_LEVELS_QUERY : GET_UNTRACKED_PRODUCTS_QUERY;

    try {
      const response = await gqlExecutor.request(queryToUse, {
        first: fetchSize,
        after: cursor,
        query: productQuery,
      });

      if (response?.errors && response.errors.some((e: any) => e.message?.includes("inventoryLevels") || e.message?.includes("read_inventory"))) {
        console.warn("[Query Note] Token lacks read_inventory for inventoryLevels pre-fetch. Falling back to base variant query...");
        useLevelsInQuery = false;
        continue;
      }

      const productsData = response?.data?.products;
      const nodes: ProductNode[] = productsData?.nodes || [];

      for (const prod of nodes) {
        scannedProducts++;
        const variants = prod.variants?.nodes || [];
        for (const v of variants) {
          candidateVariants.push({ product: prod, variant: v });
          if (limitParam > 0 && candidateVariants.length >= limitParam) {
            hasNextPage = false;
            break;
          }
        }
        if (!hasNextPage) break;
      }

      hasNextPage = hasNextPage && Boolean(productsData?.pageInfo?.hasNextPage);
      cursor = productsData?.pageInfo?.endCursor || null;
    } catch (err: any) {
      console.error(`[Products Query Error] ${err.message}`);
      break;
    }
  }

  console.log(`[Products Query] Scanned ${scannedProducts} product(s). Found ${candidateVariants.length} total variant(s) in scope.\n`);

  if (candidateVariants.length === 0) {
    console.log("✨ No variants found matching the query scope. Nothing to process.");
    return;
  }

  // 4. Process Variants
  const logEntries: LogEntry[] = [];
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  console.log(`Processing ${candidateVariants.length} variant(s)...`);
  console.log("-----------------------------------------------------------------");

  for (let i = 0; i < candidateVariants.length; i++) {
    const { product, variant } = candidateVariants[i];
    const prefix = `[${i + 1}/${candidateVariants.length}]`;
    const skuLabel = variant.sku || "(No SKU)";
    const trackedStatus = variant.inventoryItem?.tracked ? "Tracked: true" : "Tracked: false";

    const logEntry = await processVariantInventory(gqlExecutor, product, variant, targetLocation, IS_DRY_RUN);
    logEntries.push(logEntry);

    if (logEntry.status === "success") {
      successCount++;
      const actionDesc = IS_DRY_RUN
        ? `[PLAN] Set tracked: true & activate @ ${targetLocation.name} (qty: 0)`
        : `✓ Activated @ ${targetLocation.name} (tracked: true, qty: 0)`;
      console.log(`${prefix} SKU: ${skuLabel.padEnd(14)} | "${product.title.slice(0, 30)}" | ${actionDesc}`);
    } else if (logEntry.status === "skipped") {
      skippedCount++;
      console.log(`${prefix} SKU: ${skuLabel.padEnd(14)} | "${product.title.slice(0, 30)}" | ℹ️ Skipped (Already tracked & active @ ${targetLocation.name})`);
    } else {
      failedCount++;
      console.error(`${prefix} SKU: ${skuLabel.padEnd(14)} | "${product.title.slice(0, 30)}" | ❌ Failed: ${logEntry.errorMessage}`);
    }

    // Small delay to respect rate limits
    if (!IS_DRY_RUN) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // 5. Write Log File
  const logDir = path.resolve(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFilePath = path.join(logDir, `inventory-fix-${timestamp}.json`);
  fs.writeFileSync(logFilePath, JSON.stringify(logEntries, null, 2), "utf-8");

  // Also write a human-readable CSV summary
  const csvFilePath = path.join(logDir, `inventory-fix-${timestamp}.csv`);
  const csvRows = [
    "Product ID,Product Title,Variant ID,SKU,Previous Tracked,New Tracked,Location Activated,Location Name,Status,Error",
    ...logEntries.map((e) =>
      [
        `"${e.productId}"`,
        `"${e.productTitle.replace(/"/g, '""')}"`,
        `"${e.variantId}"`,
        `"${e.sku}"`,
        e.previousTracked,
        e.newTracked,
        e.locationActivated,
        `"${e.locationName}"`,
        e.status,
        `"${(e.errorMessage || "").replace(/"/g, '""')}"`,
      ].join(",")
    ),
  ];
  fs.writeFileSync(csvFilePath, csvRows.join("\n"), "utf-8");

  // 6. Print Summary
  console.log("\n=================================================================");
  console.log("                        EXECUTION SUMMARY                        ");
  console.log("=================================================================");
  console.log(` Mode                     : ${IS_DRY_RUN ? "DRY RUN (No changes made)" : "LIVE EXECUTION"}`);
  console.log(` Products Scanned         : ${scannedProducts}`);
  console.log(` Variants Processed       : ${candidateVariants.length}`);
  console.log(` Successfully Activated   : ${successCount}`);
  console.log(` Skipped (Already Active) : ${skippedCount}`);
  console.log(` Failed                   : ${failedCount}`);
  console.log(` Audit JSON Log           : ${logFilePath}`);
  console.log(` Audit CSV Log            : ${csvFilePath}`);
  console.log("=================================================================\n");

  if (failedCount > 0) {
    console.log("Failed Items Detail:");
    logEntries
      .filter((e) => e.status === "failed")
      .forEach((f) => console.log(` - SKU: ${f.sku} (Variant: ${f.variantId}): ${f.errorMessage}`));
  }
}

main().catch((err) => {
  console.error("Fatal Error in fix-untracked-inventory script:", err);
  process.exit(1);
});
