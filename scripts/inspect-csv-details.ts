import fs from "fs";
import path from "path";

function main() {
  const itemCsvPath = path.resolve(process.cwd(), "Item.csv");
  if (!fs.existsSync(itemCsvPath)) {
    console.error("Item.csv not found");
    return;
  }

  const content = fs.readFileSync(itemCsvPath, "utf-8");
  const lines = content.split(/\r?\n/).filter(l => l.trim());

  console.log("Total lines in Item.csv:", lines.length);

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let inside = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inside && line[i + 1] === '"') { field += '"'; i++; }
        else { inside = !inside; }
      } else if (c === ',' && !inside) {
        fields.push(field.trim());
        field = "";
      } else {
        field += c;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  console.log("Headers count:", headers.length);
  headers.forEach((h, idx) => console.log(` [${idx}] ${h}`));

  const locIdx = headers.findIndex(h => h.toLowerCase() === "location name");
  const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");
  const skuIdx = headers.findIndex(h => h.toLowerCase() === "sku");
  const nameIdx = headers.findIndex(h => h.toLowerCase() === "item name");

  const locCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const locStatusCounts: Record<string, Record<string, number>> = {};

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    const loc = locIdx !== -1 && row[locIdx] ? row[locIdx] : "(EMPTY)";
    const status = statusIdx !== -1 && row[statusIdx] ? row[statusIdx] : "(EMPTY)";

    locCounts[loc] = (locCounts[loc] || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (!locStatusCounts[loc]) locStatusCounts[loc] = {};
    locStatusCounts[loc][status] = (locStatusCounts[loc][status] || 0) + 1;
  }

  console.log("\n--- Location Name Breakdown ---");
  console.table(locCounts);

  console.log("\n--- Status Breakdown ---");
  console.table(statusCounts);

  console.log("\n--- Location vs Status Breakdown ---");
  console.log(JSON.stringify(locStatusCounts, null, 2));

  // Check if Stock Summary Report or another file exists in parent dir
  const parentDir = path.resolve(process.cwd(), "..");
  const parentFiles = fs.readdirSync(parentDir);
  console.log("\nFiles in parent d:\\shopify directory:", parentFiles);
}

main();
