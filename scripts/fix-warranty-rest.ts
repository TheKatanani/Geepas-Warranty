import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: "ae53cd-2.myshopify.com" },
  });

  const shop = session!.shop;
  const token = session!.accessToken;

  // 1. Fetch warranty product via REST API
  console.log("Fetching warranty product via REST API...");
  const restRes = await fetch(`https://${shop}/admin/api/2024-07/products/10332687401251.json`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
  });
  const restData = await restRes.json();
  console.log("Warranty Product REST Data:\n", JSON.stringify(restData, null, 2));

  // 2. Fetch coffee machine via REST API to see published_scope
  console.log("\nFetching coffee machine via REST API...");
  const coffeeRes = await fetch(`https://${shop}/admin/api/2024-07/products/10018934554915.json`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
  });
  const coffeeData = await coffeeRes.json();
  console.log("Coffee Machine REST Data:\n", JSON.stringify(coffeeData, null, 2));

  // 3. Update warranty product to have published_scope = 'global' / 'web' and published: true
  console.log("\nUpdating warranty product to published_scope = 'web' and published = true...");
  const updateRes = await fetch(`https://${shop}/admin/api/2024-07/products/10332687401251.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      product: {
        id: 10332687401251,
        published: true,
        published_scope: "global",
        status: "active",
        variants: [
          {
            id: 55477194653987,
            price: "0.00",
            inventory_management: null,
            inventory_policy: "continue"
          }
        ]
      }
    }),
  });
  console.log("Update Result:", await updateRes.json());
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
