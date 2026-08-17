import { PrismaClient } from "@prisma/client";
import { unauthenticated } from "../app/shopify.server";

const SHOP = "ae53cd-2.myshopify.com";
const prisma = new PrismaClient();

const GET_ORDERS_QUERY = `#graphql
  query getRecentOrders {
    orders(first: 10, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        customer {
          id
          firstName
          lastName
          email
          phone
        }
        shippingAddress {
          city
          phone
        }
        lineItems(first: 50) {
          nodes {
            id
            title
            sku
            product {
              id
              title
              handle
            }
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

async function main() {
  console.log("==================================================");
  console.log(" Syncing Warranty Orders to PostgreSQL Database");
  console.log(" Shop:", SHOP);
  console.log("==================================================");

  const { admin } = await unauthenticated.admin(SHOP);
  const res: any = await admin.graphql(GET_ORDERS_QUERY);
  const data = await res.json();
  const orders = data?.data?.orders?.nodes || [];

  console.log(`Fetched ${orders.length} recent orders.`);

  for (const ord of orders) {
    const warrantyItems = ord.lineItems.nodes.filter((l: any) =>
      l.product?.handle === "extended-warranty-3-years" ||
      l.customAttributes.some((a: any) => a.key === "_protects_product_id")
    );

    if (warrantyItems.length === 0) continue;

    console.log(`\nFound Warranty in Order: ${ord.name} (Status: ${ord.displayFinancialStatus})`);

    const orderNumber = ord.name.replace("#", "");
    const customer = ord.customer;
    const phone = customer?.phone || ord.shippingAddress?.phone || "N/A";
    const email = customer?.email || "customer@shopify.com";
    const firstName = customer?.firstName || customer?.lastName || "Customer";
    const customerId = customer?.id || "gid://shopify/Customer/0";
    const city = ord.shippingAddress?.city || "Baghdad";
    const purchaseDate = new Date(ord.createdAt);

    for (const wItem of warrantyItems) {
      const bundleId = wItem.customAttributes.find((a: any) => a.key === "_warranty_bundle_id")?.value;
      const protectsId = wItem.customAttributes.find((a: any) => a.key === "_protects_product_id")?.value;

      // Find paired appliance
      const applianceItem = ord.lineItems.nodes.find((l: any) => {
        if (l.id === wItem.id) return false;
        const bId = l.customAttributes.find((a: any) => a.key === "_warranty_bundle_id")?.value;
        if (bundleId && bId === bundleId) return true;
        if (protectsId && l.product?.id && l.product.id.includes(protectsId)) return true;
        return false;
      });

      const productTitle = applianceItem?.title || "Protected Appliance";
      const productSku = applianceItem?.sku || null;
      const prodId = applianceItem?.product?.id || null;

      // Check if already in DB
      const existing = await prisma.warrantyRegistration.findFirst({
        where: {
          shop: SHOP,
          invoiceNumber: orderNumber,
        },
      });

      if (existing) {
        console.log(`  ℹ️ Order #${orderNumber} is already registered in database (ID: ${existing.id}).`);
      } else {
        const reg = await prisma.warrantyRegistration.create({
          data: {
            shop: SHOP,
            customerId: customerId,
            firstName: firstName,
            email: email,
            phone: phone,
            city: city,
            store: "Online Store (Geepas Iraq)",
            purchaseDate: purchaseDate,
            invoiceNumber: orderNumber,
            status: "approved",
            products: {
              create: [
                {
                  productId: prodId,
                  productTitle: productTitle,
                  sku: productSku,
                  isManual: false,
                },
              ],
            },
          },
        });
        console.log(`  🎉 Successfully inserted WarrantyRegistration for Order #${orderNumber} (${productTitle}) into DB!`);
      }
    }
  }

  console.log("\n==================================================");
  console.log(" Sync Completed!");
  console.log("==================================================");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
