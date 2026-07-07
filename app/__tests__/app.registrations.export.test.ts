import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import ExcelJS from "exceljs";

vi.mock("../shopify.server", () => ({
  authenticate: { admin: vi.fn() },
}));

vi.mock("../db.server", () => ({
  default: {
    warrantyRegistration: { count: vi.fn(), findMany: vi.fn() },
    customerReward: { findMany: vi.fn() },
  },
}));

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loader, action } from "../routes/app.registrations.export";

const authAdminMock = authenticate.admin as unknown as Mock;
const countMock = prisma.warrantyRegistration.count as unknown as Mock;
const findManyMock = prisma.warrantyRegistration.findMany as unknown as Mock;
const rewardFindManyMock = prisma.customerReward.findMany as unknown as Mock;

function buildRegistration(overrides: Record<string, any> = {}) {
  return {
    id: "reg-1",
    shop: "test.myshopify.com",
    firstName: "Ali",
    email: "ali@example.com",
    phone: "+9647701234567",
    createdAt: new Date("2026-01-15T00:00:00Z"),
    products: [{ productTitle: "Geepas Blender", sku: "GA-1234" }],
    smsLogs: [{ smsSent: true }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET/POST /app/registrations/export", () => {
  it("rejects an unauthenticated GET request without touching the database", async () => {
    authAdminMock.mockRejectedValue(new Response(null, { status: 401 }));

    await expect(
      loader({
        request: new Request("https://example.com/app/registrations/export"),
      } as any),
    ).rejects.toBeTruthy();

    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated POST request without touching the database", async () => {
    authAdminMock.mockRejectedValue(new Response(null, { status: 401 }));

    await expect(
      action({
        request: new Request("https://example.com/app/registrations/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ["reg-1"] }),
        }),
      } as any),
    ).rejects.toBeTruthy();

    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("exports only the POSTed ids, scoped to the authenticated shop", async () => {
    authAdminMock.mockResolvedValue({ session: { shop: "test.myshopify.com" } });
    countMock.mockResolvedValue(2);
    findManyMock.mockResolvedValue([
      buildRegistration({ id: "reg-1" }),
      buildRegistration({ id: "reg-2", firstName: "Sara" }),
    ]);
    rewardFindManyMock.mockResolvedValue([]);

    const res = await action({
      request: new Request("https://example.com/app/registrations/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["reg-1", "reg-2"] }),
      }),
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain(
      "warranty-registrations-",
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shop: "test.myshopify.com", id: { in: ["reg-1", "reg-2"] } },
      }),
    );

    // A registration belonging to another shop, or not in the id list, must
    // never leak in — verified by asserting the where clause above, and here
    // by checking the generated file only contains the two mocked rows.
    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(3); // header + 2 data rows
    expect(sheet.getRow(1).getCell(1).value).toBe("Registration Date");
    expect(sheet.getRow(1).font?.bold).toBe(true);
  });

  it("rejects a POST with no ids", async () => {
    authAdminMock.mockResolvedValue({ session: { shop: "test.myshopify.com" } });

    const res = await action({
      request: new Request("https://example.com/app/registrations/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      }),
    } as any);

    expect(res.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rejects an export beyond the 10,000 row cap", async () => {
    authAdminMock.mockResolvedValue({ session: { shop: "test.myshopify.com" } });
    countMock.mockResolvedValue(10001);

    const res = await loader({
      request: new Request("https://example.com/app/registrations/export"),
    } as any);

    expect(res.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
