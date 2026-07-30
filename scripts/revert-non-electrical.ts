import { unauthenticated } from "../app/shopify.server";
import { isElectricalProduct } from "../app/utils/electrical-filter.server";

const DELETE_VARIANT_MUTATION = `#graphql
  mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_OPTION_MUTATION = `#graphql
  mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!]) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate) {
      userErrors {
        field
        message
      }
    }
  }
`;

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  let hasNextPage = true;
  let cursor: string | null = null;
  let revertedCount = 0;

  console.log("Starting Non-Electrical Warranty Reversion Cleanup...\n");

  while (hasNextPage) {
    const res: any = await admin.graphql(`#graphql
      query getProductsForRevert($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            productType
            tags
            status
            options {
              id
              name
              optionValues {
                id
                name
              }
            }
            variants(first: 50) {
              nodes {
                id
                title
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `, { variables: { first: 20, after: cursor } });

    const data = await res.json();
    const nodes = data?.data?.products?.nodes || [];

    for (const p of nodes) {
      if (p.status !== "ACTIVE") continue;
      if (isElectricalProduct(p)) continue; // Skip electrical products!

      const warrantyOpt = p.options?.find((o: any) => o.name.toLowerCase() === "warranty");
      if (!warrantyOpt) continue; // Already clean!

      console.log(`[Reverting Non-Electrical] "${p.title}" (${p.id})`);

      // 1. Delete 3-Year variant if present
      const v3yr = p.variants?.nodes?.find((v: any) =>
        v.selectedOptions?.some((so: any) => so.name.toLowerCase() === "warranty" && so.value === "3 Years")
      );

      if (v3yr) {
        console.log(`  Deleting 3-Year variant ${v3yr.id}`);
        await admin.graphql(DELETE_VARIANT_MUTATION, { variables: { productId: p.id, variantsIds: [v3yr.id] } });
      }

      // 2. Revert Warranty option name back to Title / Default Title if base product
      const baseVal = warrantyOpt.optionValues?.find((v: any) => v.name.includes("Year") || v.name.includes("Free") || v.name === "1 Year (Standard)" || v.name === "2 Years(Free)");
      if (baseVal && p.options.length === 1) {
        console.log(`  Reverting option name "Warranty" -> "Title" and "${baseVal.name}" -> "Default Title"`);
        await admin.graphql(UPDATE_OPTION_MUTATION, {
          variables: {
            productId: p.id,
            option: { id: warrantyOpt.id, name: "Title" },
            optionValuesToUpdate: [{ id: baseVal.id, name: "Default Title" }],
          },
        });
      }

      revertedCount++;
    }

    hasNextPage = Boolean(data?.data?.products?.pageInfo?.hasNextPage);
    cursor = data?.data?.products?.pageInfo?.endCursor || null;
  }

  console.log(`\nCleanup Finished: Successfully reverted ${revertedCount} non-electrical products.`);
}

main().catch(console.error);
