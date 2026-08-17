import { unauthenticated } from "../app/shopify.server";
import prisma from "../app/db.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");
  const res: any = await admin.graphql(`
    query {
      shop {
        name
        myshopifyDomain
        plan {
          displayName
          partnerDevelopment
          shopifyPlus
        }
      }
    }
  `);
  console.log("Shop Plan Data:", JSON.stringify(await res.json(), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
