/**
 * One-shot script to list all Zoho Inventory pricebooks in your org.
 *
 * Usage (from the project root):
 *   pnpm tsx scripts/list-zoho-pricebooks.ts
 *
 * Requires these env vars to be set (copy from .env or Vercel):
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
 *   ZOHO_ORGANIZATION_ID, ZOHO_REGION (optional, default: "com")
 *
 * Copy the pricebook_id of the correct pricebook and set it as ZOHO_PRICEBOOK_ID.
 */

// Pass your .env vars via the shell before running, e.g.:
//   set -a && source .env && set +a   (bash)
//   pnpm list-pricebooks               (after exporting vars in your shell)
// Or run with tsx's --env-file flag:
//   pnpm tsx --env-file=.env scripts/list-zoho-pricebooks.ts
import { listPricebooks } from "../app/services/zoho.server.js";

listPricebooks()
  .then((books) => {
    if (books.length === 0) {
      console.log("No pricebooks found. Check your ZOHO_ORGANIZATION_ID.");
    } else {
      const defaultBook = books.find((b) => b.is_default);
      if (defaultBook) {
        console.log(`\nDefault pricebook: ${defaultBook.pricebook_id} ("${defaultBook.name}")`);
        console.log(`Set in env:  ZOHO_PRICEBOOK_ID="${defaultBook.pricebook_id}"`);
      }
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
