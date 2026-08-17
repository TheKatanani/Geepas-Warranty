async function testRegion(region: string) {
  const domain = region.startsWith(".") ? region.slice(1) : region;
  const ACCOUNTS_URL = `https://accounts.zoho.${domain}/oauth/v2/token`;
  const API_BASE = `https://www.zohoapis.${domain}/inventory/v1`;

  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  try {
    const res = await fetch(`${ACCOUNTS_URL}?${params.toString()}`, { method: "POST" });
    const data = await res.json() as any;
    if (!data.access_token) {
      console.log(`[Region: ${domain}] OAuth refresh failed:`, data.error || data);
      return;
    }
    const token = data.access_token;
    console.log(`[Region: ${domain}] OAuth SUCCESS! Access token obtained.`);

    // List organizations
    const orgRes = await fetch(`${API_BASE}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const orgData = await orgRes.json() as any;
    console.log(`[Region: ${domain}] Organizations response:`, JSON.stringify(orgData));

    // Try items
    const orgId = process.env.ZOHO_ORGANIZATION_ID || orgData.organizations?.[0]?.organization_id;
    if (orgId) {
      const itemsRes = await fetch(`${API_BASE}/items?organization_id=${orgId}&per_page=5`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const itemsData = await itemsRes.json() as any;
      console.log(`[Region: ${domain}] Items endpoint response:`, JSON.stringify(itemsData));
    }
  } catch (err: any) {
    console.log(`[Region: ${domain}] Error:`, err.message);
  }
}

async function main() {
  const regions = ["com", "eu", "in", "com.au", "jp", "sa", "me", "ca"];
  for (const r of regions) {
    console.log(`\n=== Testing Zoho Region: ${r} ===`);
    await testRegion(r);
  }
}

main().catch(console.error);
