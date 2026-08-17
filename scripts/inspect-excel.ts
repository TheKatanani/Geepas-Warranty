import path from "path";
import ExcelJS from "exceljs";

async function main() {
  const xlsxPath = path.resolve(process.cwd(), "..", "Stock Summary Report.xlsx");
  console.log("Reading Excel file:", xlsxPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  console.log("Worksheets count:", workbook.worksheets.length);

  workbook.worksheets.forEach((sheet, idx) => {
    console.log(`\nSheet [${idx}] Name: "${sheet.name}" | Rows count: ${sheet.rowCount}`);

    if (sheet.rowCount > 0) {
      console.log("First 5 rows:");
      for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
        const rowValues = sheet.getRow(r).values;
        console.log(` Row ${r}:`, JSON.stringify(rowValues));
      }
    }
  });
}

main().catch(console.error);
