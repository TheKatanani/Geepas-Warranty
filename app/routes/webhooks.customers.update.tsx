import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { unauthenticated } from "../shopify.server";
import { processCustomerVoucher } from "../lib/voucher-processing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[${topic}] webhook received for ${shop}`);

  const raw = payload as {
    id: number;
    first_name?: string;
    phone?: string;
    tags?: string;
  };

  console.log(`[${topic}] customer ${raw.id} tags: "${raw.tags}"`);

  const tags = (raw.tags ?? "")
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  const { admin } = await unauthenticated.admin(shop);

  const result = await processCustomerVoucher(
    admin,
    {
      id: `gid://shopify/Customer/${raw.id}`,
      firstName: raw.first_name ?? "",
      phone: raw.phone ?? "",
      tags,
    },
    topic,
  );

  console.log(`[${topic}] result:`, result);

  return new Response(null, { status: 200 });
};
