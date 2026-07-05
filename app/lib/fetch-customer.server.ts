import { unauthenticated } from "../shopify.server";

/**
 * customers/create and customers/update webhooks arrive with GDPR-redacted
 * payloads (only id, first_name, phone — no email, no last_name). This
 * fetches the full customer record via the authenticated Admin GraphQL API
 * so callers never have to rely on the webhook payload for those fields.
 */

const CUSTOMER_QUERY = `#graphql
  query getCustomer($id: ID!) {
    customer(id: $id) {
      firstName
      lastName
      email
      phone
      defaultAddress { name }
    }
  }
`;

export interface AdminCustomer {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  defaultAddressName: string | null;
}

export async function fetchCustomerFromAdmin(
  shop: string,
  customerId: number | string,
): Promise<AdminCustomer> {
  const gid = `gid://shopify/Customer/${customerId}`;
  const { admin } = await unauthenticated.admin(shop);

  const response = await admin.graphql(CUSTOMER_QUERY, { variables: { id: gid } });
  const data = (await response.json()) as any;

  if (data?.errors) {
    throw new Error(`Admin GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const customer = data?.data?.customer;
  if (!customer) {
    throw new Error(`Admin GraphQL returned no customer for ${gid}`);
  }

  return {
    firstName: customer.firstName ?? null,
    lastName: customer.lastName ?? null,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    defaultAddressName: customer.defaultAddress?.name ?? null,
  };
}
