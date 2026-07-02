import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn() },
}));

vi.mock("../db.server", () => ({
  default: {
    sMSLog: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    customerReward: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("./infobip.server", () => ({
  sendWarrantySms: vi.fn(),
}));

import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendWarrantySms } from "./infobip.server";
import { issueRewardAndNotify } from "./reward.server";

const adminMock = unauthenticated.admin as unknown as Mock;
const findUniqueMock = prisma.sMSLog.findUnique as unknown as Mock;
const upsertMock = prisma.sMSLog.upsert as unknown as Mock;
const customerRewardUpsertMock = prisma.customerReward.upsert as unknown as Mock;
const sendWarrantySmsMock = sendWarrantySms as unknown as Mock;

function fakeDiscountResponse(code: string) {
  return {
    json: async () => ({
      data: {
        discountCodeBasicCreate: {
          codeDiscountNode: {
            id: "gid://shopify/DiscountCodeNode/1",
            codeDiscount: { codes: { edges: [{ node: { code } }] } },
          },
          userErrors: [],
        },
      },
    }),
  };
}

describe("issueRewardAndNotify — dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({});
    customerRewardUpsertMock.mockResolvedValue({});
    sendWarrantySmsMock.mockResolvedValue({
      success: true,
      messageId: "msg-1",
      phone: "+9647701234567",
      timestamp: new Date().toISOString(),
      isDuplicate: false,
    });
  });

  it("sends the SECOND15 SMS only once across two first-order deliveries for the same customer", async () => {
    adminMock.mockResolvedValue({
      admin: { graphql: vi.fn().mockResolvedValue(fakeDiscountResponse("SECOND15-111")) },
    });
    // First call: no existing dedupeKey row. Second call: the row now exists.
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "sms-1", dedupeKey: "second15:gid://shopify/Customer/111" });

    const params = {
      shop: "test.myshopify.com",
      customerId: "gid://shopify/Customer/111",
      phone: "+9647701234567",
      customerName: "Ali",
      productName: "Geepas Blender",
      registrationId: "order-1-second15",
      registrationDate: new Date("2026-01-01"),
      rewardType: "SECOND15",
      discountPercentage: 15,
      expiryDays: 60,
      dedupeKey: "second15:gid://shopify/Customer/111",
    };

    const first = await issueRewardAndNotify(params);
    const second = await issueRewardAndNotify(params);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true); // dedup short-circuit still reports success
    expect(sendWarrantySmsMock).toHaveBeenCalledTimes(1);
  });

  it("sends the NEXT15 SMS only once when the same order webhook is delivered twice", async () => {
    adminMock.mockResolvedValue({
      admin: { graphql: vi.fn().mockResolvedValue(fakeDiscountResponse("NEXT15-222")) },
    });
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "sms-2", dedupeKey: "next15:5551234" });

    const params = {
      shop: "test.myshopify.com",
      customerId: "gid://shopify/Customer/222",
      phone: "+9647701234567",
      customerName: "Sara",
      productName: "Geepas Blender",
      registrationId: "order-5551234-next15",
      registrationDate: new Date("2026-01-01"),
      rewardType: "NEXT15",
      discountPercentage: 15,
      expiryDays: 60,
      dedupeKey: "next15:5551234",
    };

    const first = await issueRewardAndNotify(params);
    const second = await issueRewardAndNotify(params);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(sendWarrantySmsMock).toHaveBeenCalledTimes(1);
  });

  it("passes rewardType through to sendWarrantySms so the correct template is picked", async () => {
    adminMock.mockResolvedValue({
      admin: { graphql: vi.fn().mockResolvedValue(fakeDiscountResponse("SECOND15-333")) },
    });
    findUniqueMock.mockResolvedValue(null);

    await issueRewardAndNotify({
      shop: "test.myshopify.com",
      customerId: "gid://shopify/Customer/333",
      phone: "+9647701234567",
      customerName: "Omar",
      productName: "Geepas Blender",
      registrationId: "order-3-second15",
      registrationDate: new Date("2026-01-01"),
      rewardType: "SECOND15",
      discountPercentage: 15,
      expiryDays: 60,
      dedupeKey: "second15:gid://shopify/Customer/333",
    });

    expect(sendWarrantySmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ rewardType: "SECOND15" }),
    );
  });
});
