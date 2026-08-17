import { unauthenticated } from "../app/shopify.server.js";

async function main() {
  const shop = process.env.SHOP || "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  console.log("Testing modern Shopify GraphQL Product Creation...");

  // Step 1: Create Product
  const createMutation = `#graphql
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          status
          variants(first: 5) {
            nodes {
              id
              sku
              price
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
    title: "TEST ZOHO SYNC PRODUCT - GWD17021",
    vendor: "GEEPAS",
    productType: "Water Dispenser",
    descriptionHtml: "<p>Test Zoho Product Sync Creation</p>",
    status: "DRAFT",
  };

  const response: any = await admin.graphql(createMutation, { variables: { input } });
  const json: any = await response.json();
  console.log("Product Create Response:\n", JSON.stringify(json, null, 2));

  const product = json.data?.productCreate?.product;
  const defaultVariantId = product?.variants?.nodes?.[0]?.id;

  if (defaultVariantId) {
    console.log(`Updating default variant ${defaultVariantId} with SKU, price, and barcode...`);
    const updateVariantMutation = `#graphql
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            sku
            price
            barcode
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variantInput = {
      id: defaultVariantId,
      sku: "GWD17021",
      price: "208500",
      barcode: "6294015519426",
    };

    const vRes: any = await admin.graphql(updateVariantMutation, { variables: { input: variantInput } });
    const vJson: any = await vRes.json();
    console.log("Variant Update Response:\n", JSON.stringify(vJson, null, 2));
  }
}

main().catch(console.error);
