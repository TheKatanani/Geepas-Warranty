import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

/**
 * DEPRECATED — no longer the active voucher delivery path.
 *
 * Voucher SMS is now sent immediately via the CUSTOMERS_UPDATE webhook in
 * webhooks.customers.update.tsx, which fires when Shopify Flow adds the
 * "voucher-ready:<TIER>:<CODE>" tag to a customer.
 *
 * This route is kept so that vercel.json doesn't 404, but it is a no-op.
 * The vercel.json cron entry can be removed once you confirm the webhook
 * path is working in production.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[cron.process-vouchers] DEPRECATED — SMS is now delivered by webhooks.customers.update");
  return json({
    deprecated: true,
    message: "Voucher SMS is now delivered immediately via the CUSTOMERS_UPDATE webhook. This cron is a no-op.",
  });
};
