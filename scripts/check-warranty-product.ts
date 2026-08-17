import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: "ae53cd-2.myshopify.com" },
  });

  if (!session) {
    console.error("No session found");
    return;
  }

  const shop = session.shop;
  const token = session.accessToken;

  // 1. Fetch warranty product
  const res = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        query {
          product(id: "gid://shopify/Product/10332687401251") {
            id
            handle
            title
            status
            publishedOnCurrentPublication
            variants(first: 5) {
              nodes {
                id
                title
                price
                availableForSale
              }
            }
          }
          publications(first: 5) {
            nodes {
              id
              name
            }
          }
        }
      `,
    }),
  });

  const data = await res.json();
  console.log("Warranty Product Data:", JSON.stringify(data, null, 2));

  // If not published to online store publication, publish it!
  const publications = data.data?.publications?.nodes || [];
  const prod = data.data?.product;
  if (prod && publications.length > 0) {
    for (const pub of publications) {
      console.log(`Publishing product to publication: ${pub.name} (${pub.id})`);
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
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            id: prod.id,
            input: [{ publicationId: pub.id }],
          },
        }),
      });
      console.log("Publish result:", await pubRes.json());
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
