import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fetching active Shopify sessions from DB...");
  const sessions = await prisma.session.findMany();
  console.log(`Found ${sessions.length} sessions.`);

  for (const session of sessions) {
    console.log(`\nShop: ${session.shop}`);
    console.log(`Scope from DB session: ${session.scope}`);
    console.log(`Is Online: ${session.isOnline}`);
    console.log(`Expires: ${session.expires}`);

    if (session.accessToken) {
      console.log("Querying Shopify Admin API for current installation scopes...");
      try {
        // Query current app installation scopes via GraphQL API
        const url = `https://${session.shop}/admin/api/2024-04/graphql.json`;
        const query = {
          query: `{
            currentAppInstallation {
              accessScopes {
                handle
                description
              }
            }
          }`
        };

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
          },
          body: JSON.stringify(query),
        });

        if (!res.ok) {
          console.error(`HTTP error fetching scopes: ${res.status} ${res.statusText}`);
          const text = await res.text();
          console.error("Response body:", text);
          continue;
        }

        const data: any = await res.json();
        if (data.errors) {
          console.error("GraphQL errors:", data.errors);
        } else {
          const scopes = data?.data?.currentAppInstallation?.accessScopes || [];
          console.log("Shopify Active Access Scopes:");
          scopes.forEach((s: any) => {
            console.log(`  - ${s.handle} (${s.description})`);
          });
        }
      } catch (err: any) {
        console.error("Failed to query Shopify API:", err.message);
      }
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
