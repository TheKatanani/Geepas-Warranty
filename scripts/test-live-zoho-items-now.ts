import { fetchZohoItems } from "../app/services/zoho.server.js";

async function main() {
  console.log("==================================================");
  console.log("     TESTING LIVE ZOHO ITEMS API (FULL ACCESS)    ");
  console.log("==================================================");

  try {
    const items = await fetchZohoItems();
    console.log(`\n🎉 SUCCESS! Successfully fetched ${items.length} items directly from LIVE Zoho API!`);

    if (items.length > 0) {
      console.log("\nSample Live Zoho Items (First 5):");
      items.slice(0, 5).forEach((item, idx) => {
        console.log(` ${idx + 1}. SKU: ${item.sku.padEnd(12)} | Name: ${item.name.padEnd(35)} | Stock: ${item.stock_on_hand} | Location: ${item.location_name || "(None)"}`);
      });

      // Breakdown location names in live Zoho items
      const locBreakdown: Record<string, number> = {};
      items.forEach(i => {
        const loc = i.location_name || i.warehouse_name || "(EMPTY)";
        locBreakdown[loc] = (locBreakdown[loc] || 0) + 1;
      });
      console.log("\nLive Zoho API Items Location Breakdown:", locBreakdown);
    }
  } catch (err: any) {
    console.error("\n❌ Error fetching live Zoho items:", err.message);
  }
}

main().catch(console.error);
