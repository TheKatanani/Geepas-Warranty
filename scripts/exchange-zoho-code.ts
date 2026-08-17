import fs from "fs";
import path from "path";

async function main() {
  const args = process.argv.slice(2);
  const code = args[0]?.trim();
  const clientId = args[1]?.trim() || process.env.ZOHO_CLIENT_ID || "";
  const clientSecret = args[2]?.trim() || process.env.ZOHO_CLIENT_SECRET || "";

  if (!code) {
    console.log("Usage: npx tsx --env-file=.env scripts/exchange-zoho-code.ts <GRANT_CODE> [CLIENT_ID] [CLIENT_SECRET]");
    console.log("\nExample:");
    console.log("  npx tsx --env-file=.env scripts/exchange-zoho-code.ts 1000.xxxxx 1000.4G2HHNTGF6... b899fff75c4c...");
    return;
  }

  const region = (process.env.ZOHO_REGION ?? "com").replace(/^\./, "");
  const ACCOUNTS_URL = `https://accounts.zoho.${region}/oauth/v2/token`;

  console.log("Exchanging Zoho Grant Code for Refresh Token...");
  console.log(` Client ID : ${clientId}`);
  console.log(` Region    : ${region}`);

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
  });

  const res = await fetch(`${ACCOUNTS_URL}?${params.toString()}`, { method: "POST" });
  const data = await res.json() as any;

  if (!data.refresh_token) {
    console.error("\n❌ Failed to generate refresh token:", JSON.stringify(data, null, 2));
    console.log("\nPossible reasons:");
    console.log(" 1. The grant code expired (codes expire in 10 minutes).");
    console.log(" 2. Client ID or Client Secret mismatch.");
    console.log(" 3. The code was already used once.");
    return;
  }

  console.log("\n🎉 SUCCESS! Generated New Refresh Token:");
  console.log("==================================================");
  console.log(` ZOHO_CLIENT_ID     = ${clientId}`);
  console.log(` ZOHO_CLIENT_SECRET = ${clientSecret}`);
  console.log(` ZOHO_REFRESH_TOKEN = ${data.refresh_token}`);
  console.log("==================================================");

  // Update .env file automatically
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf-8");

    envContent = envContent.replace(/ZOHO_CLIENT_ID=.*/g, `ZOHO_CLIENT_ID=${clientId}`);
    envContent = envContent.replace(/ZOHO_CLIENT_SECRET=.*/g, `ZOHO_CLIENT_SECRET=${clientSecret}`);
    envContent = envContent.replace(/ZOHO_REFRESH_TOKEN=.*/g, `ZOHO_REFRESH_TOKEN=${data.refresh_token}`);

    fs.writeFileSync(envPath, envContent, "utf-8");
    console.log("\n✅ Automatically updated .env file with new credentials!");
  }
}

main().catch(console.error);
