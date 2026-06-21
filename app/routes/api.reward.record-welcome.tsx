import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { normalizePhone } from "../utils/twilio.server";

/**
 * POST /api/reward/record-welcome
 *
 * Records that a WELCOME_10 discount code was issued from the main website.
 * This prevents warranty flow from issuing duplicate welcome rewards.
 *
 * Body: { shop, phone, customerId, discountCode }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { shop, phone, customerId, discountCode } = body;

    if (!shop || !phone || !customerId || !discountCode) {
      return json(
        { error: "shop, phone, customerId, and discountCode are required." },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);

    // Check if already exists
    const existing = await prisma.customerReward.findUnique({
      where: {
        shop_phone_rewardType: {
          shop,
          phone: normalizedPhone,
          rewardType: "WELCOME_10",
        },
      },
    });

    if (existing) {
      return json({
        success: true,
        message: "WELCOME_10 reward already recorded for this phone.",
        alreadyExists: true,
      });
    }

    await prisma.customerReward.create({
      data: {
        shop,
        phone: normalizedPhone,
        customerId,
        rewardType: "WELCOME_10",
        discountCode,
      },
    });

    return json({ success: true, alreadyExists: false }, { status: 201 });
  } catch (error: any) {
    console.error("[record-welcome] Error:", error);
    return json(
      { error: "Failed to record welcome reward." },
      { status: 500 }
    );
  }
};
