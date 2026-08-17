import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: "ae53cd-2.myshopify.com" },
  });

  const shop = session!.shop;
  const token = session!.accessToken;

  // 1. Fetch coffee machine product
  const coffeeRes = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
        query {
          productByHandle(handle: "espresso-coffee-machine") {
            id
            title
            variants(first: 5) {
              nodes {
                id
                title
                price
              }
            }
          }
          warranty: productByHandle(handle: "extended-warranty-3-years") {
            id
            title
            status
            variants(first: 5) {
              nodes {
                id
                title
                price
                availableForSale
              }
            }
          }
        }
      `,
    }),
  });

  const data = await coffeeRes.json();
  console.log("Products:", JSON.stringify(data, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
