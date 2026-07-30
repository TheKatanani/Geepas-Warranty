import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock DB server
vi.mock("../db.server", () => ({
  default: {
    sMSLog: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// Set environment variables for tests
process.env.INFOBIP_API_KEY = "dummy-api-key";
process.env.INFOBIP_BASE_URL = "https://dummy-base-url.api.infobip.com";
process.env.INFOBIP_WHATSAPP_SENDER = "447860099299";

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

function extractSentPayload(fetchMock: Mock): any {
  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(options.body as string);
}

describe("sendWarrantySms — WhatsApp Template Mapping", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    findFirstMock.mockReset().mockResolvedValue(null); // no dedup hit
    fetchMock = mockInfobipFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses the warranty template (warranty_registration) with 10 placeholders when rewardType is absent", async () => {
    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Ali",
      voucherCode: "WARRANTY15-111",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "reg-1",
      registrationDate: new Date("2026-01-01T12:00:00.000Z"),
      voucherExpiryDays: 30,
      lang: "ar",
      shop: "test.myshopify.com",
    });

    const payload = extractSentPayload(fetchMock);
    const message = payload.messages[0];

    expect(message.to).toBe("+9647701234567");
    expect(message.content.templateName).toBe("warranty_registration");
    
    const placeholders = message.content.templateData.body.placeholders;
    expect(placeholders.length).toBe(10);
    
    // Arabic portion
    expect(placeholders[0]).toBe("Ali");
    expect(placeholders[1]).toBe("Geepas Blender");
    expect(placeholders[2]).toBe("WARRANTY15-111");
    expect(placeholders[3]).toBe("365");
    expect(placeholders[4]).toContain("٢٠٢٦");

    // English portion (duplicates)
    expect(placeholders[5]).toBe("Ali");
    expect(placeholders[6]).toBe("Geepas Blender");
    expect(placeholders[7]).toBe("WARRANTY15-111");
    expect(placeholders[8]).toBe("365");
    expect(placeholders[9]).toContain("2026");
  });

  it("uses the voucher template (voucher_code) with 8 placeholders for SECOND15", async () => {
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

    const payload = extractSentPayload(fetchMock);
    const message = payload.messages[0];

    expect(message.to).toBe("+9647701234567");
    expect(message.content.templateName).toBe("voucher_code");
    
    const placeholders = message.content.templateData.body.placeholders;
    expect(placeholders.length).toBe(8);

    // Arabic portion
    expect(placeholders[0]).toBe("Sara");
    expect(placeholders[1]).toBe("15");
    expect(placeholders[2]).toBe("SECOND15-222");
    expect(placeholders[3]).toBe("60");

    // English portion
    expect(placeholders[4]).toBe("Sara");
    expect(placeholders[5]).toBe("15");
    expect(placeholders[6]).toBe("SECOND15-222");
    expect(placeholders[7]).toBe("60");
  });

  it("uses the voucher template (voucher_code) with 8 placeholders for NEXT15", async () => {
    await sendWarrantySms({
      phoneNumber: "07701234567",
      customerName: "Omar",
      voucherCode: "NEXT15-333",
      productName: "Geepas Blender",
      warrantyDays: 365,
      registrationId: "order-3-next15",
      registrationDate: new Date("2026-01-01"),
      voucherExpiryDays: 45,
      lang: "ar",
      shop: "test.myshopify.com",
      rewardType: "NEXT15",
    });

    const payload = extractSentPayload(fetchMock);
    const message = payload.messages[0];

    expect(message.to).toBe("+9647701234567");
    expect(message.content.templateName).toBe("voucher_code");
    
    const placeholders = message.content.templateData.body.placeholders;
    expect(placeholders.length).toBe(8);

    // Arabic portion
    expect(placeholders[0]).toBe("Omar");
    expect(placeholders[1]).toBe("15");
    expect(placeholders[2]).toBe("NEXT15-333");
    expect(placeholders[3]).toBe("45");

    // English portion
    expect(placeholders[4]).toBe("Omar");
    expect(placeholders[5]).toBe("15");
    expect(placeholders[6]).toBe("NEXT15-333");
    expect(placeholders[7]).toBe("45");
  });

  it("sends gift_card_notification with 6 placeholders and language ar", async () => {
    const { sendWhatsAppTemplate } = await import("./infobip.server");

    await sendWhatsAppTemplate({
      phoneNumber: "07701234567",
      templateName: "gift_card_notification",
      placeholders: ["Recipient", "50,000 IQD", "****-1234", "Recipient", "50,000 IQD", "****-1234"],
      language: "ar",
    });

    const payload = extractSentPayload(fetchMock);
    const message = payload.messages[0];

    expect(message.to).toBe("+9647701234567");
    expect(message.content.templateName).toBe("gift_card_notification");
    expect(message.content.templateData.body.placeholders).toEqual(["Recipient", "50,000 IQD", "****-1234", "Recipient", "50,000 IQD", "****-1234"]);
    expect(message.content.templateData.header).toBeUndefined();
  });

  it("includes IMAGE header when mediaUrl is explicitly passed", async () => {
    const { sendWhatsAppTemplate } = await import("./infobip.server");

    await sendWhatsAppTemplate({
      phoneNumber: "07701234567",
      templateName: "gift_card_notification",
      placeholders: ["Recipient", "50,000 IQD", "****-1234", "Recipient", "50,000 IQD", "****-1234"],
      mediaUrl: "https://cdn.shopify.com/s/files/1/0820/2226/9219/files/21.jpg",
      language: "ar",
    });

    const payload = extractSentPayload(fetchMock);
    const message = payload.messages[0];

    expect(message.content.templateData.header).toEqual({
      type: "IMAGE",
      mediaUrl: "https://cdn.shopify.com/s/files/1/0820/2226/9219/files/21.jpg",
    });
  });
});
