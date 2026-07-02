import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// db.server is mocked so the DB-backed dedup check inside sendWarrantySms
// never touches a real database — it just needs to resolve "no recent send".
vi.mock("../db.server", () => ({
  default: {
    sMSLog: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from "../db.server";
import { sendWarrantySms } from "./infobip.server";

const findFirstMock = prisma.sMSLog.findFirst as unknown as Mock;

function mockInfobipFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({
        messages: [{ status: { groupName: "PENDING" }, messageId: "msg-1" }],
      }),
  });
}

/** Pulls the SMS body text out of the (mocked) fetch call sent to Infobip. */
function extractSentText(fetchMock: Mock): string {
  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  const payload = JSON.parse(options.body as string);
  return payload.messages[0].text as string;
}

describe("sendWarrantySms — SMS template selected by rewardType", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    findFirstMock.mockReset().mockResolvedValue(null); // no dedup hit
    fetchMock = mockInfobipFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses the warranty template (with رقم الضمان / مدة الضمان / تاريخ التسجيل) when rewardType is absent", async () => {
    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Ali",
      voucherCode: "WARRANTY15-111",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "reg-1",
      registrationDate: new Date("2026-01-01"),
      voucherExpiryDays: 30,
      lang: "ar",
      shop: "test.myshopify.com",
      // no rewardType -> warranty-registration path
    });

    const text = extractSentText(fetchMock);
    expect(text).toContain("رقم الضمان");
    expect(text).toContain("مدة الضمان");
    expect(text).toContain("تاريخ التسجيل");
  });

  it("uses a discount-only template for SECOND15 — no warranty fields", async () => {
    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Sara",
      voucherCode: "SECOND15-222",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "order-2-second15",
      registrationDate: new Date("2026-01-01"),
      voucherExpiryDays: 60,
      lang: "ar",
      shop: "test.myshopify.com",
      rewardType: "SECOND15",
    });

    const text = extractSentText(fetchMock);
    expect(text).toContain("SECOND15-222"); // discount code present
    expect(text).toContain("60"); // validity period present
    expect(text).not.toContain("رقم الضمان");
    expect(text).not.toContain("مدة الضمان");
    expect(text).not.toContain("تاريخ التسجيل");
  });

  it("uses a discount-only template for NEXT15 — no warranty fields", async () => {
    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Omar",
      voucherCode: "NEXT15-333",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "order-3-next15",
      registrationDate: new Date("2026-01-01"),
      voucherExpiryDays: 60,
      lang: "ar",
      shop: "test.myshopify.com",
      rewardType: "NEXT15",
    });

    const text = extractSentText(fetchMock);
    expect(text).toContain("NEXT15-333"); // discount code present
    expect(text).toContain("60"); // validity period present
    expect(text).not.toContain("رقم الضمان");
    expect(text).not.toContain("مدة الضمان");
    expect(text).not.toContain("تاريخ التسجيل");
  });

  it("SECOND15 and NEXT15 bodies are worded differently from each other", async () => {
    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Sara",
      voucherCode: "SECOND15-222",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "order-2-second15",
      registrationDate: new Date("2026-01-01"),
      voucherExpiryDays: 60,
      lang: "ar",
      shop: "test.myshopify.com",
      rewardType: "SECOND15",
    });
    const second15Text = extractSentText(fetchMock);

    fetchMock = mockInfobipFetch();
    vi.stubGlobal("fetch", fetchMock);

    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Sara",
      voucherCode: "SECOND15-222",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "order-2-next15",
      registrationDate: new Date("2026-01-01"),
      voucherExpiryDays: 60,
      lang: "ar",
      shop: "test.myshopify.com",
      rewardType: "NEXT15",
    });
    const next15Text = extractSentText(fetchMock);

    expect(second15Text).not.toBe(next15Text);
  });
});
