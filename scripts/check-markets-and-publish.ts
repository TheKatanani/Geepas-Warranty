import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  console.log("Checking markets, publications, and catalogs...");

  // Query product and catalogs/markets
  const res = await admin.graphql(`
    query {
      markets(first: 10) {
        nodes {
          id
          name
          enabled
          webPresence {
            rootUrls {
              locale
              url
            }
          }
        }
      }
      publications(first: 10) {
        nodes {
          id
          name
          autoPublish
        }
      }
      catalogs(first: 10) {
        nodes {
          id
          title
          status
          publication {
            id
          }
        }
      }
      productByHandle(handle: "extended-warranty-3-years") {
        id
        title
        status
        totalVariants
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
  `);

  const json = await res.json();
  console.log("Shopify Market & Product Info:\n", JSON.stringify(json, null, 2));

  const prod = json.data?.productByHandle;
  const pubs = json.data?.publications?.nodes || [];
  const catalogs = json.data?.catalogs?.nodes || [];

  if (prod) {
    // 1. Publish to ALL publications
    for (const pub of pubs) {
      console.log(`Publishing to publication ${pub.name} (${pub.id})`);
      const pRes = await admin.graphql(`
        mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          id: prod.id,
          input: [{ publicationId: pub.id }]
        }
      });
      console.log("Publish result:", await pRes.json());
    }

    // 2. Add product to all catalogs
    for (const cat of catalogs) {
      console.log(`Adding product to catalog ${cat.title} (${cat.id})`);
      const catRes = await admin.graphql(`
        mutation catalogContextUpdate($catalogId: ID!, $context: CatalogContextInput!) {
          catalogContextUpdate(catalogId: $catalogId, context: $context) {
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          catalogId: cat.id,
          context: {}
        }
      });
    }
  }
}

main().catch(console.error);
