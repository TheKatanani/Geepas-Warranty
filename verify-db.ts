import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Checking DB tables...");
  try {
    const regCount = await prisma.warrantyRegistration.count();
    console.log("WarrantyRegistration exists, count:", regCount);
  } catch (err: any) {
    console.error("WarrantyRegistration check failed:", err.message);
  }

  try {
    const prodCount = await prisma.warrantyProduct.count();
    console.log("WarrantyProduct exists, count:", prodCount);
  } catch (err: any) {
    console.error("WarrantyProduct check failed:", err.message);
  }

  try {
    const rewardCount = await prisma.customerReward.count();
    console.log("CustomerReward exists, count:", rewardCount);
  } catch (err: any) {
    console.error("CustomerReward check failed:", err.message);
  }

  try {
    const smsCount = await prisma.sMSLog.count();
    console.log("SMSLog exists, count:", smsCount);
  } catch (err: any) {
    console.error("SMSLog check failed:", err.message);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
