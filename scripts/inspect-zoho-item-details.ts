async function main() {
  const region = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
  const API_BASE = `https://www.zohoapis.${region}/inventory/v1`;
  const ACCOUNTS_URL = `https://accounts.zoho.${region}/oauth/v2/token`;
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";

  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";

  const tokenParams = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const tokenRes = await fetch(`${ACCOUNTS_URL}?${tokenParams.toString()}`, { method: "POST" });
  const tokenData = await tokenRes.json() as any;
  const token = tokenData.access_token;

  console.log("Fetching live items list from Zoho...");
  const res = await fetch(`${API_BASE}/items?organization_id=${orgId}&per_page=5`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const data = await res.json() as any;

  if (!data.items || data.items.length === 0) {
    console.error("No items found:", data);
    return;
  }

  const firstItemId = data.items[0].item_id;
  console.log(`Inspecting full item details for item_id=${firstItemId}...`);

  const detailRes = await fetch(`${API_BASE}/items/${firstItemId}?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const detailData = await detailRes.json() as any;

  console.log("Full Item Detail JSON:\n", JSON.stringify(detailData, null, 2));
}

main().catch(console.error);
