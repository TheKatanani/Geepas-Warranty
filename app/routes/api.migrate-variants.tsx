import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import {
  BASE_WARRANTY_VALUE,
  EXTENDED_WARRANTY_VALUE,
  WARRANTY_OPTION_NAME,
  calculateWarrantyPrice,
  shouldUpdateWarrantyPrice,
} from "../utils/warranty-pricing.server";

const GET_PRODUCTS_QUERY = `#graphql
  query getProductsForWarrantyMigration($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:ACTIVE") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        options {
          id
          name
          position
          optionValues {
            id
            name
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            selectedOptions {
              name
              value
            }
            inventoryItem {
              tracked
            }
          }
        }
      }
    }
  }`;

const PRODUCT_OPTION_UPDATE_MUTATION = `#graphql
  mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!], $optionValuesToAdd: [OptionValueCreateInput!]) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate, optionValuesToAdd: $optionValuesToAdd) {
      userErrors {
        field
        message
      }
      product {
        id
        options {
          id
          name
          position
          optionValues {
            id
            name
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            selectedOptions {
              name
              value
            }
            inventoryItem {
              tracked
            }
          }
        }
      }
    }
  }`;

const PRODUCT_OPTION_CREATE_MUTATION = `#graphql
  mutation productOptionCreate($productId: ID!, $option: OptionCreateInput!) {
    productOptionCreate(productId: $productId, option: $option) {
      userErrors {
        field
        message
      }
      product {
        id
        options {
          id
          name
          position
          optionValues {
            id
            name
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            selectedOptions {
              name
              value
            }
            inventoryItem {
              tracked
            }
          }
        }
      }
    }
  }`;

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

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `#graphql
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "ae53cd-2.myshopify.com";
  const limitParam = parseInt(url.searchParams.get("limit") || "0", 10);
  const dryRun = url.searchParams.get("dryRun") === "true";

  try {
    const { admin } = await unauthenticated.admin(shop);

    let hasNextPage = true;
    let cursor: string | null = null;
    let processedCount = 0;
    const logs: string[] = [];

    while (hasNextPage) {
      const fetchSize = limitParam > 0 && limitParam - processedCount < 20 ? limitParam - processedCount : 20;

      const response: any = await admin.graphql(GET_PRODUCTS_QUERY, {
        variables: { first: fetchSize, after: cursor },
      });

      const jsonResponse: any = await response.json();
      const productsData: any = jsonResponse?.data?.products;
      const nodes = productsData?.nodes || [];

      for (const product of nodes) {
        let variants = product.variants?.nodes || [];
        let options = product.options || [];

        if (variants.length === 0) {
          logs.push(`[Skip] Product "${product.title}" (${product.id}) has no variants.`);
          continue;
        }

        const baseVariant =
          variants.find((v: any) =>
            v.selectedOptions.some(
              (opt: any) => opt.name === WARRANTY_OPTION_NAME && opt.value === BASE_WARRANTY_VALUE,
            ),
          ) || variants[0];

        const basePrice = parseFloat(baseVariant.price || "0");
        if (basePrice <= 0) {
          logs.push(`[Skip] Product "${product.title}" has zero/invalid base price`);
          continue;
        }

        const expected3YrPrice = calculateWarrantyPrice(basePrice);

        let warrantyOption = options.find(
          (o: any) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase(),
        );

        if (!warrantyOption) {
          const titleOption = options.find((o: any) => o.name.toLowerCase() === "title");

          if (titleOption) {
            logs.push(`[Option Update] "${product.title}" — Updating option "Title" -> "Warranty"`);
            if (!dryRun) {
              const defaultVal = titleOption.optionValues?.find((v: any) => v.name === "Default Title") || titleOption.optionValues?.[0];
              const updateRes = await admin.graphql(PRODUCT_OPTION_UPDATE_MUTATION, {
                variables: {
                  productId: product.id,
                  option: { id: titleOption.id, name: WARRANTY_OPTION_NAME },
                  optionValuesToUpdate: defaultVal ? [{ id: defaultVal.id, name: BASE_WARRANTY_VALUE }] : [],
                  optionValuesToAdd: [{ name: EXTENDED_WARRANTY_VALUE }],
                },
              });
              const updateData = await updateRes.json();
              const updatedProd = updateData?.data?.productOptionUpdate?.product;
              if (updatedProd) {
                options = updatedProd.options || options;
                variants = updatedProd.variants?.nodes || variants;
                warrantyOption = options.find((o: any) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase());
              }
            }
          } else {
            logs.push(`[Option Create] "${product.title}" — Creating Warranty option for multi-option product`);
            if (!dryRun) {
              const createRes = await admin.graphql(PRODUCT_OPTION_CREATE_MUTATION, {
                variables: {
                  productId: product.id,
                  option: {
                    name: WARRANTY_OPTION_NAME,
                    values: [{ name: BASE_WARRANTY_VALUE }, { name: EXTENDED_WARRANTY_VALUE }],
                  },
                },
              });
              const createData = await createRes.json();
              const updatedProd = createData?.data?.productOptionCreate?.product;
              if (updatedProd) {
                options = updatedProd.options || options;
                variants = updatedProd.variants?.nodes || variants;
                warrantyOption = options.find((o: any) => o.name.toLowerCase() === WARRANTY_OPTION_NAME.toLowerCase());
              }
            }
          }
        }

        const existing3YrVariants = variants.filter((v: any) =>
          v.selectedOptions.some(
            (opt: any) => opt.name === WARRANTY_OPTION_NAME && opt.value === EXTENDED_WARRANTY_VALUE,
          ),
        );

        if (existing3YrVariants.length > 0) {
          for (const v3yr of existing3YrVariants) {
            const needsUpdate = shouldUpdateWarrantyPrice(basePrice, v3yr.price);
            if (!needsUpdate) {
              logs.push(`[OK] "${product.title}" — 3-Year variant already synced at ${v3yr.price} IQD`);
            } else {
              logs.push(`[Update Price] "${product.title}" — 3-Year variant price from ${v3yr.price} to ${expected3YrPrice} IQD`);
              if (!dryRun) {
                await admin.graphql(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
                  variables: {
                    productId: product.id,
                    variants: [{ id: v3yr.id, price: expected3YrPrice.toString(), inventoryItem: { tracked: false } }],
                  },
                });
              }
            }
          }
        } else if (warrantyOption) {
          const threeYearValObj = warrantyOption.optionValues?.find(
            (val: any) => val.name === EXTENDED_WARRANTY_VALUE,
          );

          if (threeYearValObj) {
            logs.push(`[Create Variant] "${product.title}" — Creating 3-Year variant at ${expected3YrPrice} IQD`);
            if (!dryRun) {
              await admin.graphql(PRODUCT_VARIANTS_BULK_CREATE_MUTATION, {
                variables: {
                  productId: product.id,
                  variants: [
                    {
                      optionValues: [{ optionId: warrantyOption.id, id: threeYearValObj.id }],
                      price: expected3YrPrice.toString(),
                      inventoryItem: { tracked: false },
                    },
                  ],
                },
              });
            }
          }
        }

        processedCount++;
        if (limitParam > 0 && processedCount >= limitParam) {
          hasNextPage = false;
          break;
        }
      }

      hasNextPage = hasNextPage && Boolean(productsData?.pageInfo?.hasNextPage);
      cursor = productsData?.pageInfo?.endCursor || null;
    }

    return json({ success: true, processedCount, logs });
  } catch (error: any) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
