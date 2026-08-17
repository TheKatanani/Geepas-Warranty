import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: "ae53cd-2.myshopify.com" },
  });

  const shop = session!.shop;
  const token = session!.accessToken;

  // 1. Check publications of the working Coffee Machine vs Warranty product
  const query = `
    query {
      coffee: product(id: "gid://shopify/Product/10018934554915") {
        id
        title
        status
        resourcePublicationsV2(first: 10) {
          nodes {
            isPublished
            publication {
              id
              name
            }
          }
        }
        variants(first: 1) {
          nodes {
            id
            inventoryPolicy
            inventoryItem {
              tracked
            }
          }
        }
      }
      warranty: product(id: "gid://shopify/Product/10332687401251") {
        id
        title
        status
        resourcePublicationsV2(first: 10) {
          nodes {
            isPublished
            publication {
              id
              name
            }
          }
        }
        variants(first: 1) {
          nodes {
            id
            inventoryPolicy
            inventoryItem {
              id
              tracked
            }
          }
        }
      }
      publications(first: 10) {
        nodes {
          id
          name
        }
      }
    }
  `;

  const res = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  console.log("Comparison Data:\n", JSON.stringify(data, null, 2));

  // 2. Make sure warranty product is published on EVERY publication that coffee machine is published on
  const coffeePubs = data.data?.coffee?.resourcePublicationsV2?.nodes || [];
  const warranty = data.data?.warranty;

  for (const pubNode of coffeePubs) {
    const pubId = pubNode.publication.id;
    console.log(`Publishing warranty to ${pubNode.publication.name} (${pubId})...`);
    const pubRes = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
          mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              publishable {
                availablePublicationCount
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          id: warranty.id,
          input: [{ publicationId: pubId }]
        }
      }),
    });
    console.log("Publish result:", await pubRes.json());
  }

  // 3. Make sure warranty variant has inventoryPolicy = CONTINUE and tracked = false
  const varId = warranty.variants.nodes[0].id;
  console.log(`Updating warranty variant ${varId} inventory policy to CONTINUE...`);
  const updateRes = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        mutation productVariantUpdate($input: ProductVariantInput!) {
          productVariantUpdate(input: $input) {
            productVariant {
              id
              inventoryPolicy
              availableForSale
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: {
        input: {
          id: varId,
          inventoryPolicy: "CONTINUE"
        }
      }
    }),
  });
  console.log("Variant update result:", await updateRes.json());
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
