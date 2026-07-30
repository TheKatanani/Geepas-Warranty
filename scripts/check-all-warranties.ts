import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalCount = 0;
  let withWarrantyCount = 0;
  let activeCount = 0;
  let missingActive: any[] = [];

  while (hasNextPage) {
    const res: any = await admin.graphql(`#graphql
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            handle
            status
            options {
              name
              optionValues {
                name
              }
            }
          }
        }
      }
    `, { variables: { first: 50, after: cursor } });

    const data = await res.json();
    const nodes = data?.data?.products?.nodes || [];

    for (const p of nodes) {
      totalCount++;
      if (p.status === "ACTIVE") activeCount++;
      const hasWarranty = p.options.some((o: any) => o.name.toLowerCase() === "warranty");
      if (hasWarranty) {
        withWarrantyCount++;
      } else if (p.status === "ACTIVE") {
        missingActive.push({ id: p.id, title: p.title, handle: p.handle, status: p.status });
      }
    }

    hasNextPage = Boolean(data?.data?.products?.pageInfo?.hasNextPage);
    cursor = data?.data?.products?.pageInfo?.endCursor || null;
  }

  console.log(`Total Products on Store: ${totalCount}`);
  console.log(`Active Products: ${activeCount}`);
  console.log(`Products with Warranty Option: ${withWarrantyCount}`);
  console.log(`Active Products Missing Warranty: ${missingActive.length}`);
  if (missingActive.length > 0) {
    console.log("Missing Active Products:", JSON.stringify(missingActive, null, 2));
  }
}

main().catch(console.error);
