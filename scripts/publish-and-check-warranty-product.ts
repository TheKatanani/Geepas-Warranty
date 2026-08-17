import { unauthenticated } from "../app/shopify.server";

async function main() {
  const { admin } = await unauthenticated.admin("ae53cd-2.myshopify.com");

  console.log("Checking warranty product...");

  const res = await admin.graphql(`
    query {
      product(id: "gid://shopify/Product/10332687401251") {
        id
        handle
        title
        status
        variants(first: 5) {
          nodes {
            id
            title
            price
          }
        }
      }
      publications(first: 10) {
        nodes {
          id
        }
      }
    }
  `);

  const data = await res.json();
  console.log("Product & Publications:", JSON.stringify(data, null, 2));

  const prod = data.data?.product;
  const pubs = data.data?.publications?.nodes || [];

  if (prod) {
    // 1. Ensure product is ACTIVE
    await admin.graphql(`
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        input: {
          id: prod.id,
          status: "ACTIVE"
        }
      }
    });

    // 2. Publish to all publications (Online Store, Point of Sale, etc.)
    for (const pub of pubs) {
      console.log(`Publishing to publication ${pub.id}...`);
      const pubRes = await admin.graphql(`
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
          input: [{ publicationId: pub.id }],
        },
      });
      console.log("Publish result:", await pubRes.json());
    }
  }
}

main().catch(console.error);
