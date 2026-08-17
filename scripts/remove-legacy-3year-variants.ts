import { unauthenticated } from "../app/shopify.server";

const SHOP = "ae53cd-2.myshopify.com";

const GET_PRODUCTS_QUERY = `#graphql
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "tag:warranty-eligible") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        variants(first: 20) {
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
`;

const DELETE_VARIANT_MUTATION = `#graphql
  mutation deleteVariant($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      userErrors {
        field
        message
      }
    }
  }
`;

async function main() {
  console.log("==================================================");
  console.log(" Cleaning up legacy '3 Years' variants from products");
  console.log(" Shop:", SHOP);
  console.log("==================================================");

  const { admin } = await unauthenticated.admin(SHOP);

  let hasNextPage = true;
  let cursor: string | null = null;
  let cleanedCount = 0;
  let totalScanned = 0;

  while (hasNextPage) {
    const res: any = await admin.graphql(GET_PRODUCTS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const data = await res.json();
    const products = data?.data?.products?.nodes || [];
    hasNextPage = data?.data?.products?.pageInfo?.hasNextPage || false;
    cursor = data?.data?.products?.pageInfo?.endCursor || null;

    for (const prod of products) {
      totalScanned++;
      if (prod.handle === "extended-warranty-3-years") continue;

      const legacyVariants = prod.variants.nodes.filter((v: any) =>
        v.title.toLowerCase().includes("3 year") ||
        v.selectedOptions.some((o: any) => o.value.toLowerCase().includes("3 year"))
      );

      if (legacyVariants.length > 0) {
        console.log(`\nFound legacy variant on: "${prod.title}" (${prod.id})`);
        const variantIdsToDelete = legacyVariants.map((v: any) => v.id);
        console.log(`  Deleting variant IDs:`, variantIdsToDelete);

        const delRes: any = await admin.graphql(DELETE_VARIANT_MUTATION, {
          variables: {
            productId: prod.id,
            variantsIds: variantIdsToDelete,
          },
        });
        const delData = await delRes.json();
        const userErrors = delData?.data?.productVariantsBulkDelete?.userErrors || [];
        if (userErrors.length > 0) {
          console.error(`  ❌ Errors:`, userErrors);
        } else {
          console.log(`  ✅ Successfully deleted legacy warranty variant(s)`);
          cleanedCount++;
        }
      }
    }
  }

  console.log("\n==================================================");
  console.log(` Finished! Scanned ${totalScanned} products, cleaned ${cleanedCount} products.`);
  console.log("==================================================");
}

main().catch(console.error);
