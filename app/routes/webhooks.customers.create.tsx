import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const LOG = "[customers/create]";

/**
 * CUSTOMERS_CREATE webhook — no-op.
 *
 * WELCOME10 is now issued by Shopify Flow + email natively.
 * The app no longer issues any voucher on customer creation.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`${LOG} ${topic} received for shop=${shop} — handled by Shopify Flow, no app action`);
  return new Response(null, { status: 200 });
};
