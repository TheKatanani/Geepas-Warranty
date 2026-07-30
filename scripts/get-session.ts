import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
});

async function main() {
  console.log("Connecting to DB:", directUrl?.replace(/:[^:@]+@/, ":***@"));
  const sessions = await prisma.session.findMany();
  console.log(`Found ${sessions.length} session(s):`);
  for (const s of sessions) {
    console.log(`  Shop: ${s.shop}`);
    console.log(`  Scope: ${s.scope}`);
    console.log(`  Expires: ${s.expires}`);
    console.log(`  Token: ${s.accessToken}`);
    console.log("-".repeat(40));
  }
}

main()
  .catch((e) => console.error("Error:", e))
  .finally(() => prisma.$disconnect());
