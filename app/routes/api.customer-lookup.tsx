import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { normalizePhone } from "../utils/twilio.server";

/**
 * GET /api/customer-lookup?phone=07701234567&shop=store.myshopify.com
 *
 * Public endpoint - looks up a Shopify customer by normalized phone number.
 * Returns customer info if found, or { exists: false } otherwise.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone");
  const shop = url.searchParams.get("shop");

  if (!phone || !shop) {
    return json(
      { error: "phone and shop query parameters are required" },
      { status: 400 }
    );
  }

  console.log("[customer-lookup] Incoming phone:", phone);
  const normalized = normalizePhone(phone);
  console.log("[customer-lookup] Normalized phone:", normalized);

  try {
    const { admin } = await unauthenticated.admin(shop);

    const query = `#graphql
      query customerByPhone($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              firstName
              lastName
              email
              phone
            }
          }
        }
      }`;
    const variables = { query: `phone:${normalized}` };

    console.log("[customer-lookup] Shopify lookup query:", query, "variables:", variables);

    const response = await admin.graphql(query, { variables });
    const data = (await response.json()) as any;
    
    console.log("[customer-lookup] Shopify response:", JSON.stringify(data, null, 2));

    if (data?.errors) {
      console.error("[customer-lookup] GraphQL errors returned from Shopify:", data.errors);
      return json({
        exists: false,
        lookupFailed: true,
        error: data.errors[0]?.message || "GraphQL error",
      });
    }

    const edges = data?.data?.customers?.edges || [];

    if (edges.length > 0) {
      const customer = edges[0].node;
      console.log("[customer-lookup] Customer found on Shopify:", customer.id);
      return json({
        exists: true,
        customerId: customer.id,
        firstName: customer.firstName || "",
        lastName: customer.lastName || "",
        email: customer.email || "",
        phone: customer.phone || normalized,
      });
    }

    console.log("[customer-lookup] Customer not found on Shopify (valid state).");
    return json({ exists: false });
  } catch (error: any) {
    console.error("[customer-lookup] Actual error encountered during lookup:", error);
    // Return a non-blocking 200 response with lookupFailed: true
    return json({
      exists: false,
      lookupFailed: true,
      error: error?.message || "Internal server error",
    });
  }
};
