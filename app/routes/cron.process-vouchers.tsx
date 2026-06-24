import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import {
  processCustomerVoucher,
  type VoucherCustomer,
} from "../lib/voucher-processing.server";

// This app serves a single store.
const SHOP = "ae53cd-2.myshopify.com";

// Vercel invokes this route on the cron schedule defined in vercel.json.
// It queries for customers tagged "voucher-ready:*", processes each one,
// and returns a JSON summary.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await unauthenticated.admin(SHOP);

  // Fetch all customers that have any "voucher-ready:*" tag.
  // Shopify customer search supports tag: prefix queries.
  const response = await admin.graphql(
    `#graphql
    query voucherReadyCustomers {
      customers(first: 50, query: "tag:voucher-ready*") {
        edges {
          node {
            id
            firstName
            phone
            tags
          }
        }
      }
    }`,
  );

  const data = await response.json();
  const edges: any[] = data?.data?.customers?.edges ?? [];

  console.log(`[cron.process-vouchers] Found ${edges.length} candidate customer(s)`);

  const results = await Promise.all(
    edges.map(({ node }: any) => {
      const customer: VoucherCustomer = {
        id: node.id,
        firstName: node.firstName ?? "",
        phone: node.phone ?? "",
        tags: (node.tags as string[]) ?? [],
      };
      return processCustomerVoucher(admin, customer, "cron.process-vouchers");
    }),
  );

  const sent = results.filter((r) => r.status === "sent").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log(`[cron.process-vouchers] Done — sent: ${sent}, skipped: ${skipped}, errors: ${errors}`);

  return json({ sent, skipped, errors, total: results.length });
};
