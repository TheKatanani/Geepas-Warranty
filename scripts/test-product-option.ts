import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const shop = "ae53cd-2.myshopify.com";

  let token = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
  if (!token) {
    try {
      const sess = await prisma.session.findFirst({
        where: { shop: { contains: shop } },
        orderBy: { expires: "desc" },
      });
      token = sess?.accessToken || "";
    } catch (e: any) {
      console.warn("DB error:", e.message);
    }
  }

  console.log("MY_TOKEN=" + token);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
