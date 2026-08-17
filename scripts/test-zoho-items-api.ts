async function main() {
  const REGION = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
  const API_BASE = `https://www.zohoapis.${REGION}/inventory/v1`;
  const ACCOUNTS_URL = `https://accounts.zoho.${REGION}/oauth/v2/token`;
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";

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
  const token = tokenData.access_token;

  console.log("Access Token acquired. Testing Zoho API endpoints...");

  // Test 1: Contacts endpoint (we know works)
  const contactsRes = await fetch(`${API_BASE}/contacts?organization_id=${orgId}&per_page=1`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  console.log("Contacts endpoint HTTP:", contactsRes.status);

  // Test 2: Items endpoint
  const itemsRes = await fetch(`${API_BASE}/items?organization_id=${orgId}&per_page=5`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  console.log("Items endpoint HTTP:", itemsRes.status);
  const itemsText = await itemsRes.text();
  console.log("Items endpoint raw response:\n", itemsText);
}

main().catch(console.error);
