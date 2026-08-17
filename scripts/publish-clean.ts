import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  // Query publications
  const pubsRes = await admin.graphql(`
    query {
      publications(first: 10) {
        nodes {
          id
        }
      }
    }
  `);
  const pubsData = await pubsRes.json();
  const pubs = pubsData.data?.publications?.nodes || [];
  console.log("Found publications:", pubs);

  for (const pub of pubs) {
    console.log(`Publishing warranty product to publication: ${pub.id}`);
    const pubRes = await admin.graphql(`
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
        id: "gid://shopify/Product/10332687401251",
        input: [{ publicationId: pub.id }]
      }
    });
    console.log("Result:", JSON.stringify(await pubRes.json(), null, 2));
  }
}

main().catch(console.error);
