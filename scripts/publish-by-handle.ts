import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  // Fetch publications via GraphQL
  const res = await admin.graphql(`
    query {
      publications(first: 10) {
        nodes {
          id
          name
        }
      }
      productByHandle(handle: "extended-warranty-3-years") {
        id
        status
        variants(first: 5) {
          nodes {
            id
            title
            price
          }
        }
      }
    }
  `);

  const json = await res.json();
  console.log("Data:", JSON.stringify(json, null, 2));

  const prod = json.data?.productByHandle;
  const pubs = json.data?.publications?.nodes || [];

  if (prod && pubs.length > 0) {
    for (const pub of pubs) {
      console.log(`Publishing ${prod.id} to ${pub.name} (${pub.id})`);
      const pRes = await admin.graphql(`
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
      `, {
        variables: {
          id: prod.id,
          input: [{ publicationId: pub.id }]
        }
      });
      console.log("Publish result:", await pRes.json());
    }
  }
}

main().catch(console.error);
