import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const res: any = await admin.graphql(`#graphql
    query getGiftCards {
      products(first: 250) {
        nodes {
          id
          title
          handle
          isGiftCard
        }
      }
    }
  `);

  const json = await res.json();
  const giftCards = json?.data?.products?.nodes?.filter((p: any) => p.isGiftCard || p.title.toLowerCase().includes("gift"));
  console.log("Gift Cards Data:\n", JSON.stringify(giftCards, null, 2));
}

main().catch(console.error);
