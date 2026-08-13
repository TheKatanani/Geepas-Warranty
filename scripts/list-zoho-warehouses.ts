import { fetchZohoItems } from "../app/services/zoho.server.js";

async function main() {
  const REGION = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
  const API_BASE = `https://www.zohoapis.${REGION}/inventory/v1`;
  const ACCOUNTS_URL = `https://accounts.zoho.${REGION}/oauth/v2/token`;
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";

  if (!orgId) throw new Error("ZOHO_ORGANIZATION_ID not set");

  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${ACCOUNTS_URL}?${params.toString()}`, { method: "POST" });
  const tokenData = await res.json() as any;
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    console.error("Token refresh failed:", tokenData);
    return;
  }

  console.log("Fetching Zoho Warehouses...");
  const whRes = await fetch(`${API_BASE}/warehouses?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  const whData = await whRes.json() as any;
  console.log("Warehouses response:\n", JSON.stringify(whData, null, 2));
}

main().catch(console.error);
