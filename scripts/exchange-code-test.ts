import fs from "fs";
import path from "path";

async function exchange(code: string, clientId: string, clientSecret: string) {
  const region = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
  const ACCOUNTS_URL = `https://accounts.zoho.${region}/oauth/v2/token`;

  console.log(`Testing exchange for Client ID: ${clientId}...`);

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
  });

  const res = await fetch(`${ACCOUNTS_URL}?${params.toString()}`, { method: "POST" });
  const data = await res.json() as any;

  return data;
}

async function main() {
  const code = "1000.4bcdc8f769e372290cbceb0019a24137.f149168571793dbaadd70aeae924b750";

  // Client 1: From current .env
  const c1_id = process.env.ZOHO_CLIENT_ID || "1000.91EN4KL1UPGDMT6H6WFAHAR78Y022A";
  const c1_secret = process.env.ZOHO_CLIENT_SECRET || "f5af31f8a64fae63ad4aff2f52cbe82a1fbfb85a62";

  console.log("=== Attempt 1: Using current .env Client ID ===");
  const res1 = await exchange(code, c1_id, c1_secret);
  console.log("Result 1:", JSON.stringify(res1, null, 2));

  if (res1.refresh_token) {
    updateEnv(c1_id, c1_secret, res1.refresh_token);
    return;
  }
}

function updateEnv(clientId: string, clientSecret: string, refreshToken: string) {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, "utf-8");
    content = content.replace(/ZOHO_CLIENT_ID=.*/g, `ZOHO_CLIENT_ID=${clientId}`);
    content = content.replace(/ZOHO_CLIENT_SECRET=.*/g, `ZOHO_CLIENT_SECRET=${clientSecret}`);
    content = content.replace(/ZOHO_REFRESH_TOKEN=.*/g, `ZOHO_REFRESH_TOKEN=${refreshToken}`);
    fs.writeFileSync(envPath, content, "utf-8");
    console.log("✅ Updated .env with new refresh token!");
  }
}

main().catch(console.error);
