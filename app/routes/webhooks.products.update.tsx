import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { isElectricalProduct } from "../utils/electrical-filter.server";
import {
  BASE_WARRANTY_VALUE,
  EXTENDED_WARRANTY_VALUE,
  WARRANTY_OPTION_NAME,
  calculateWarrantyPrice,
  shouldUpdateWarrantyPrice,
} from "../utils/warranty-pricing.server";

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
      }
      userErrors {
        field
        message
      }
    }
  }`;

function formatGid(type: "Product" | "ProductVariant", id: string | number): string {
  const str = String(id);
  if (str.startsWith("gid://shopify/")) return str;
  return `gid://shopify/${type}/${str}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  if (topic !== "PRODUCTS_UPDATE") {
    return new Response(`Unhandled topic: ${topic}`, { status: 200 });
  }

  if (!payload || !payload.id) {
    console.warn(`[PRODUCTS_UPDATE] Empty or invalid payload from shop ${shop}`);
    return new Response("Invalid payload", { status: 200 });
  }

  // Filter out non-electrical products (hand tools, cookware, accessories)
  if (!isElectricalProduct({ title: payload.title, productType: payload.product_type, tags: payload.tags })) {
    return new Response(null, { status: 200 });
  }

  const productId = formatGid("Product", payload.id);
  const variants: any[] = payload.variants || [];

  if (variants.length === 0) {
    return new Response(null, { status: 200 });
  }

  // Helper to check if a variant has a given option value
  const matchesOptionValue = (variant: any, targetValue: string): boolean => {
    if (variant.title?.includes(targetValue)) return true;
    if (variant.option1 === targetValue || variant.option2 === targetValue || variant.option3 === targetValue) {
      return true;
    }
    if (Array.isArray(variant.selected_options)) {
      return variant.selected_options.some((o: any) => o.value === targetValue);
    }
    return false;
  };

  // Find 3-Year Extended Warranty variant
  const extended3YrVariant = variants.find((v) => matchesOptionValue(v, EXTENDED_WARRANTY_VALUE));
  if (!extended3YrVariant) {
    // Product does not have a 3-Year Extended Warranty variant yet
    return new Response(null, { status: 200 });
  }

  // Find Base ("2 Years(Free)" / "1 Year (Standard)" or primary) variant
  const baseVariant =
    variants.find((v) => matchesOptionValue(v, BASE_WARRANTY_VALUE)) ||
    variants.find((v) => matchesOptionValue(v, "1 Year (Standard)")) ||
    variants.find((v) => v.id !== extended3YrVariant.id) ||
    variants[0];

  const basePrice = parseFloat(baseVariant.price || "0");
  if (basePrice <= 0) {
    console.warn(`[PRODUCTS_UPDATE] Product ${productId} has zero or invalid base price`);
    return new Response(null, { status: 200 });
  }

  const current3YrPrice = extended3YrVariant.price;

  // Phase 3 Loop Guard: Check if 3-Year variant price needs an update
  const needsUpdate = shouldUpdateWarrantyPrice(basePrice, current3YrPrice);

  if (!needsUpdate) {
    console.log(
      `[PRODUCTS_UPDATE] Loop-guard active — 3-Year variant price is already synced for product ${productId} (Base: ${basePrice}, 3-Year: ${current3YrPrice}). Skipping mutation.`,
    );
    return new Response(null, { status: 200 });
  }

  const expected3YrPrice = calculateWarrantyPrice(basePrice);
  const extended3YrGid = formatGid("ProductVariant", extended3YrVariant.id);

  console.log(
    `[PRODUCTS_UPDATE] Price update detected on base variant. Updating 3-Year variant ${extended3YrGid} price from ${current3YrPrice} to ${expected3YrPrice} IQD (Base: ${basePrice})`,
  );

  if (!admin) {
    console.warn(`[PRODUCTS_UPDATE] Admin GraphQL context missing for shop ${shop}`);
    return new Response(null, { status: 200 });
  }

  try {
    const response = await admin.graphql(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
      variables: {
        productId,
        variants: [
          {
            id: extended3YrGid,
            price: expected3YrPrice.toString(),
            inventoryItem: { tracked: false },
          },
        ],
      },
    });

    const data = await response.json();
    const errors = data?.data?.productVariantsBulkUpdate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[PRODUCTS_UPDATE] Error updating variant ${extended3YrGid}:`, errors);
    } else {
      console.log(`[PRODUCTS_UPDATE] Successfully updated 3-Year variant ${extended3YrGid} to ${expected3YrPrice} IQD`);
    }
  } catch (error: any) {
    console.error(`[PRODUCTS_UPDATE] Exception pushing price update for product ${productId}:`, error);
  }

  return new Response(null, { status: 200 });
};
