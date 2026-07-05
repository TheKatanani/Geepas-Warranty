/**
 * Inspect a real Zoho contact to discover custom field API names and pricebook
 * associations, then list all pricebooks in the org.
 *
 * Usage:
 *   pnpm inspect-zoho-contact
 *   (or: pnpm tsx --env-file=.env scripts/inspect-zoho-contact.ts)
 *
 * Requires: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
 *           ZOHO_ORGANIZATION_ID, ZOHO_REGION (optional, default: "com")
 */

const REGION = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
const ACCOUNTS_URL = `https://accounts.zoho.${REGION}/oauth/v2/token`;
const API_BASE = `https://www.zohoapis.${REGION}/inventory/v1`;
const ORG_ID = process.env.ZOHO_ORGANIZATION_ID ?? "";

async function getToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? "",
  });
  const res = await fetch(`${ACCOUNTS_URL}?${params}`, { method: "POST" });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Token error: ${data.error ?? JSON.stringify(data)}`);
  return data.access_token;
}

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

async function main() {
  if (!ORG_ID) throw new Error("ZOHO_ORGANIZATION_ID is not set.");

  const token = await getToken();
  const headers = { Authorization: `Zoho-oauthtoken ${token}` };

  // ── Section 1: Contact detail ───────────────────────────────────────────

  separator("SECTION 1 — Contact detail (first customer contact)");

  const listUrl = new URL(`${API_BASE}/contacts`);
  listUrl.searchParams.set("organization_id", ORG_ID);
  listUrl.searchParams.set("contact_type", "customer");
  listUrl.searchParams.set("per_page", "5");

  const listRes = await fetch(listUrl.toString(), { headers });
  const listData = await listRes.json() as {
    contacts?: Array<{ contact_id: string; contact_name: string }>;
  };
  const contacts = listData.contacts ?? [];

  if (contacts.length === 0) {
    console.log("No customer contacts found.");
  } else {
    const { contact_id, contact_name } = contacts[0];
    console.log(`contact_id  : ${contact_id}`);
    console.log(`contact_name: ${contact_name}\n`);

    const detailUrl = new URL(`${API_BASE}/contacts/${contact_id}`);
    detailUrl.searchParams.set("organization_id", ORG_ID);

    const detailRes = await fetch(detailUrl.toString(), { headers });
    const detailRaw = await detailRes.text();
    const detailData = JSON.parse(detailRaw) as {
      contact?: Record<string, unknown>;
    };

    // Print custom_fields section for easy scanning
    const cf = (detailData.contact?.custom_fields ?? []) as Array<{
      api_name: string;
      label: string;
      value: unknown;
    }>;

    if (cf.length > 0) {
      console.log(`custom_fields (${cf.length} entries):`);
      for (const f of cf) {
        console.log(`  api_name : ${f.api_name}`);
        console.log(`  label    : ${f.label}`);
        console.log(`  value    : ${JSON.stringify(f.value)}`);
        console.log();
      }
    } else {
      console.log("No custom_fields on this contact.\n");
    }

    // Print pricebook-related top-level fields specifically
    const c = detailData.contact ?? {};
    console.log("Pricebook-related fields on the contact:");
    for (const key of Object.keys(c).filter((k) => k.includes("pricebook") || k.includes("price_list"))) {
      console.log(`  ${key}: ${JSON.stringify(c[key])}`);
    }

    // Full raw JSON so nothing is hidden
    console.log("\nFULL raw contact JSON:");
    console.log(JSON.stringify(detailData.contact, null, 2));
  }

  // ── Section 2: All pricebooks ───────────────────────────────────────────

  separator("SECTION 2 — All pricebooks in the org");

  const pbUrl = new URL(`${API_BASE}/pricebooks`);
  pbUrl.searchParams.set("organization_id", ORG_ID);

  const pbRes = await fetch(pbUrl.toString(), { headers });
  const pbRaw = await pbRes.text();
  const pbData = JSON.parse(pbRaw) as {
    pricebooks?: Array<Record<string, unknown>>;
  };
  const books = pbData.pricebooks ?? [];

  if (books.length === 0) {
    console.log("No pricebooks found.");
  } else {
    console.log(`${books.length} pricebook(s):\n`);
    for (const b of books) {
      const status = String(b.status ?? "").toUpperCase();
      const isActive = status === "ACTIVE";
      const marker = isActive ? "  ← ACTIVE" : "";
      console.log(`  pricebook_id : ${b.pricebook_id}${marker}`);
      console.log(`  name         : ${b.name}`);
      console.log(`  status       : ${b.status ?? "(not returned)"}`);
      // Print any other fields present so nothing is hidden
      for (const [k, v] of Object.entries(b)) {
        if (!["pricebook_id", "name", "status"].includes(k)) {
          console.log(`  ${k.padEnd(14)}: ${JSON.stringify(v)}`);
        }
      }
      console.log();
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
