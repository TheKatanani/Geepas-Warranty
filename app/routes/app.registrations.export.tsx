import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import ExcelJS from "exceljs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildRegistrationWhere } from "../utils/registration-filters.server";

const MAX_ROWS = 10000;

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Registration Date", key: "registrationDate" },
  { header: "Customer Name", key: "customerName" },
  { header: "Phone", key: "phone" },
  { header: "Email", key: "email" },
  { header: "Product", key: "product" },
  { header: "Serial Number", key: "serialNumber" },
  { header: "Warranty Tier", key: "warrantyTier" },
  { header: "Voucher Code(s) Issued", key: "voucherCodes" },
  { header: "SMS Status", key: "smsStatus" },
];

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function buildRegistrationsWorkbook(where: any): Promise<ExcelJS.Workbook> {
  const registrations = await prisma.warrantyRegistration.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      products: true,
      smsLogs: { orderBy: { smsSentAt: "desc" }, take: 1 },
    },
  });

  const phones = [...new Set(registrations.map((r) => r.phone))];
  const rewards =
    phones.length > 0
      ? await prisma.customerReward.findMany({
          where: { shop: where.shop, phone: { in: phones } },
        })
      : [];
  const rewardsByPhone = new Map<string, typeof rewards>();
  for (const reward of rewards) {
    const list = rewardsByPhone.get(reward.phone) ?? [];
    list.push(reward);
    rewardsByPhone.set(reward.phone, list);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };

  for (const reg of registrations) {
    const regRewards = rewardsByPhone.get(reg.phone) ?? [];
    const latestSms = reg.smsLogs[0];

    sheet.addRow({
      registrationDate: formatDate(reg.createdAt),
      customerName: reg.firstName,
      phone: reg.phone,
      email: reg.email,
      product: reg.products.map((p) => p.productTitle).join("; ") || "—",
      serialNumber: reg.products.map((p) => p.sku || "—").join("; ") || "—",
      warrantyTier: regRewards.map((r) => r.rewardType).join(", ") || "—",
      voucherCodes: regRewards.map((r) => r.discountCode).join(", ") || "—",
      smsStatus: latestSms ? (latestSms.smsSent ? "Sent" : "Failed") : "Not sent",
    });
  }

  // Phone must stay text — Excel otherwise strips the leading "+" / "0" by
  // reinterpreting it as a number.
  sheet.getColumn("phone").numFmt = "@";

  sheet.columns.forEach((column) => {
    let maxLength = String(column.header ?? "").length;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.min(maxLength + 2, 50);
  });

  return workbook;
}

async function exportResponse(where: any) {
  const count = await prisma.warrantyRegistration.count({ where });
  if (count > MAX_ROWS) {
    return json(
      {
        error: `This export would include ${count} rows, which exceeds the ${MAX_ROWS}-row limit. Narrow your filters or selection and try again.`,
      },
      { status: 400 },
    );
  }

  const workbook = await buildRegistrationsWorkbook(where);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `warranty-registrations-${formatDate(new Date())}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// GET /app/registrations/export?search=&status=&phone= — export all matching current filters
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "all";
  const phone = url.searchParams.get("phone") || "";

  const where = buildRegistrationWhere(shop, { search, status, phone });
  return exportResponse(where);
};

// POST /app/registrations/export { ids: string[] } — export only the selected rows
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let ids: unknown;
  try {
    const body = await request.json();
    ids = body?.ids;
  } catch {
    return json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return json({ error: "No registrations selected." }, { status: 400 });
  }
  if (!ids.every((id) => typeof id === "string")) {
    return json({ error: "Invalid registration ids." }, { status: 400 });
  }
  if (ids.length > MAX_ROWS) {
    return json(
      { error: `You can export at most ${MAX_ROWS} registrations at a time.` },
      { status: 400 },
    );
  }

  const where = { shop, id: { in: ids } };
  return exportResponse(where);
};
