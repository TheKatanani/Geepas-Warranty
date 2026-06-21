import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  normalizePhone,
  sendSms,
  buildWarrantyConfirmationSms,
} from "../utils/twilio.server";

const WEBSITE_URL = process.env.WEBSITE_URL || "https://geepas.com";

/**
 * Generate a unique discount code string.
 */
function generateDiscountCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "GEEPAS15-";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * POST /api/warranty
 *
 * Full warranty registration flow:
 * 1. Validate input
 * 2. Normalize phone number
 * 3. Resolve or create Shopify customer
 * 4. Check reward eligibility (no stacking, no duplicates)
 * 5. Save registration + products
 * 6. Create Shopify discount code if eligible
 * 7. Send SMS via Twilio
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();

    const {
      shop,
      firstName,
      email,
      phone,
      city,
      store,
      purchaseDate,
      invoiceNumber,
      products,
      isNewCustomer,
    } = body;

    // --- Validation ---
    const errors: string[] = [];
    if (!shop) errors.push("Shop is required.");
    if (!firstName || firstName.trim().length < 2)
      errors.push("First name is required (min 2 characters).");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push("Valid email is required.");
    if (!phone || phone.trim().length < 7)
      errors.push("Valid phone number is required.");
    if (!city) errors.push("City is required.");
    if (!store) errors.push("Store is required.");
    if (!purchaseDate) errors.push("Purchase date is required.");
    if (!products || !Array.isArray(products) || products.length === 0)
      errors.push("At least one product is required.");

    if (errors.length > 0) {
      return json({ errors }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(phone);

    // --- Resolve Shopify Customer ---
    let customerId: string;

    try {
      const { admin } = await unauthenticated.admin(shop);

      console.log("[api.warranty] Resolving customer. Incoming phone:", phone);
      console.log("[api.warranty] Normalized phone:", normalizedPhone);

      // Look up existing customer by phone
      console.log("[api.warranty] Looking up customer by phone:", normalizedPhone);
      const lookupResult = await lookupCustomerByPhone(admin, normalizedPhone);
      if (lookupResult) {
        console.log("[api.warranty] Customer found by phone. Reusing customerId:", lookupResult);
        customerId = lookupResult;
      } else {
        console.log("[api.warranty] Customer not found by phone. Checking email or creating new customer...");
        customerId = await createOrUpdateShopifyCustomer(admin, {
          firstName: firstName.trim(),
          email: email.trim().toLowerCase(),
          phone: normalizedPhone,
        });
        console.log("[api.warranty] Resolved customerId:", customerId);
      }

      // --- Check Reward Eligibility ---
      // Rule: No stacking, no duplicates. Phone is source of truth.
      const existingReward = await prisma.customerReward.findFirst({
        where: {
          shop,
          phone: normalizedPhone,
        },
      });

      // Save warranty registration
      const registration = await prisma.warrantyRegistration.create({
        data: {
          shop,
          customerId,
          firstName: firstName.trim(),
          email: email.trim().toLowerCase(),
          phone: normalizedPhone,
          city,
          store,
          purchaseDate: new Date(purchaseDate),
          invoiceNumber: invoiceNumber?.trim() || null,
          status: "pending",
          products: {
            create: products.map((p: any) => ({
              productId: p.productId || null,
              productTitle: p.productTitle,
              sku: p.sku || null,
              isManual: p.isManual || false,
            })),
          },
        },
        include: { products: true },
      });

      // --- Discount Code Generation ---
      let discountCode: string | null = null;
      let rewardCreated = false;

      if (!existingReward) {
        // Eligible for WARRANTY_15 — no prior reward of any type
        discountCode = generateDiscountCode();

        try {
          // Create Shopify discount code via GraphQL
          await createShopifyDiscountCode(admin, discountCode, customerId);
          rewardCreated = true;
        } catch (discountErr) {
          console.error(
            "[api.warranty] Failed to create Shopify discount:",
            discountErr
          );
          // Continue — don't block registration because discount failed
        }

        if (rewardCreated) {
          await prisma.customerReward.create({
            data: {
              shop,
              phone: normalizedPhone,
              customerId,
              rewardType: "WARRANTY_15",
              discountCode,
            },
          });
        }
      }

      // --- SMS ---
      const smsBody = buildWarrantyConfirmationSms(
        firstName.trim(),
        rewardCreated ? discountCode : null,
        WEBSITE_URL
      );

      const smsResult = await sendSms(normalizedPhone, smsBody);

      // Log SMS
      await prisma.sMSLog.create({
        data: {
          shop,
          phone: normalizedPhone,
          registrationId: registration.id,
          rewardId: rewardCreated
            ? (
                await prisma.customerReward.findFirst({
                  where: {
                    shop,
                    phone: normalizedPhone,
                    rewardType: "WARRANTY_15",
                  },
                })
              )?.id || null
            : null,
          smsSent: smsResult.success,
          smsSentAt: smsResult.success ? new Date() : null,
          smsProviderResponse: smsResult.rawResponse || smsResult.error || null,
        },
      });

      return json(
        {
          success: true,
          registration: {
            id: registration.id,
            status: registration.status,
            productsCount: registration.products.length,
          },
          reward: rewardCreated
            ? { discountCode, type: "WARRANTY_15" }
            : existingReward
              ? { message: "Customer already has a reward on record." }
              : null,
          smsSent: smsResult.success,
        },
        { status: 201 }
      );
    } catch (shopifyErr: any) {
      console.error("[api.warranty] Shopify/DB error:", shopifyErr);
      return json(
        {
          error: "Failed to process warranty registration. Please try again later.",
          debug: shopifyErr instanceof Error ? shopifyErr.message : shopifyErr,
          stack: shopifyErr instanceof Error ? shopifyErr.stack : undefined,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("[api.warranty] Parse error:", error);
    return json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }
};

// ---- Helper: Lookup customer by phone ----
async function lookupCustomerByPhone(
  admin: any,
  phone: string
): Promise<string | null> {
  const query = `#graphql
    query customerByPhone($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
          }
        }
      }
    }`;
  const variables = { query: `phone:${phone}` };
  console.log("[lookupCustomerByPhone] Shopify lookup query:", query, "variables:", variables);

  const response = await admin.graphql(query, { variables });
  const data = await response.json();
  console.log("[lookupCustomerByPhone] Shopify response:", JSON.stringify(data, null, 2));

  if (data?.errors) {
    console.error("[lookupCustomerByPhone] GraphQL errors:", data.errors);
    throw new Error(`Shopify lookup error: ${JSON.stringify(data.errors)}`);
  }

  const edges = data?.data?.customers?.edges || [];
  return edges.length > 0 ? edges[0].node.id : null;
}

// ---- Helper: Create or update Shopify Customer ----
async function createOrUpdateShopifyCustomer(
  admin: any,
  input: { firstName: string; email: string; phone: string }
): Promise<string> {
  // First check if email already exists on another customer
  const queryEmail = `#graphql
    query customerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            phone
          }
        }
      }
    }`;
  const variablesEmail = { query: `email:${input.email}` };
  console.log("[createOrUpdateShopifyCustomer] Checking existing email query:", queryEmail, "variables:", variablesEmail);

  const emailCheckResponse = await admin.graphql(queryEmail, { variables: variablesEmail });
  const emailCheckData = await emailCheckResponse.json();
  console.log("[createOrUpdateShopifyCustomer] Email check response:", JSON.stringify(emailCheckData, null, 2));

  if (emailCheckData?.errors) {
    console.error("[createOrUpdateShopifyCustomer] Email check GraphQL errors:", emailCheckData.errors);
  }

  const existingByEmail = emailCheckData?.data?.customers?.edges || [];

  if (existingByEmail.length > 0) {
    const existing = existingByEmail[0].node;
    console.log("[createOrUpdateShopifyCustomer] Customer found by email. ID:", existing.id, "Existing phone:", existing.phone);

    // If email exists but phone is different, update the existing customer's phone
    if (existing.phone !== input.phone) {
      console.log("[createOrUpdateShopifyCustomer] Updating phone for customer", existing.id, "to", input.phone);
      const mutationUpdate = `#graphql
        mutation customerUpdate($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`;
      const variablesUpdate = {
        input: {
          id: existing.id,
          phone: input.phone,
        },
      };
      console.log("[createOrUpdateShopifyCustomer] Update mutation:", mutationUpdate, "variables:", variablesUpdate);

      const updateResponse = await admin.graphql(mutationUpdate, { variables: variablesUpdate });
      const updateData = await updateResponse.json();
      console.log("[createOrUpdateShopifyCustomer] Update response:", JSON.stringify(updateData, null, 2));

      const updateErrors = updateData?.data?.customerUpdate?.userErrors || [];
      if (updateErrors.length > 0) {
        console.error("[createOrUpdateShopifyCustomer] Update phone user errors:", updateErrors);
      }
    }

    return existing.id;
  }

  // Create new customer
  console.log("[createOrUpdateShopifyCustomer] Creating new customer with details:", input);
  const mutationCreate = `#graphql
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`;
  const variablesCreate = {
    input: {
      firstName: input.firstName,
      email: input.email,
      phone: input.phone,
    },
  };
  console.log("[createOrUpdateShopifyCustomer] Create mutation:", mutationCreate, "variables:", variablesCreate);

  const createResponse = await admin.graphql(mutationCreate, { variables: variablesCreate });
  const createData = await createResponse.json();
  console.log("[createOrUpdateShopifyCustomer] Create response:", JSON.stringify(createData, null, 2));

  const userErrors = createData?.data?.customerCreate?.userErrors || [];
  if (userErrors.length > 0) {
    console.error("[createOrUpdateShopifyCustomer] Customer creation user errors:", userErrors);
    // If customer creation fails (e.g. email/phone taken), try lookup by phone
    console.log("[createOrUpdateShopifyCustomer] Customer creation failed. Falling back to lookup by phone:", input.phone);
    const fallbackId = await lookupCustomerByPhone(
      admin,
      input.phone
    );
    if (fallbackId) {
      console.log("[createOrUpdateShopifyCustomer] Fallback lookup succeeded. ID:", fallbackId);
      return fallbackId;
    }
    throw new Error(
      `Customer creation failed: ${userErrors.map((e: any) => e.message).join(", ")}`
    );
  }

  const newCustomerId = createData?.data?.customerCreate?.customer?.id;
  if (!newCustomerId) {
    throw new Error("Customer creation returned no ID.");
  }

  console.log("[createOrUpdateShopifyCustomer] Customer created successfully. ID:", newCustomerId);

  // Send activation email invite
  try {
    const mutationInvite = `#graphql
      mutation customerSendAccountInviteEmail($customerId: ID!) {
        customerSendAccountInviteEmail(customerId: $customerId) {
          customer {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`;
    console.log("[createOrUpdateShopifyCustomer] Sending account invite for ID:", newCustomerId);
    const inviteResponse = await admin.graphql(mutationInvite, { variables: { customerId: newCustomerId } });
    const inviteData = await inviteResponse.json();
    console.log("[createOrUpdateShopifyCustomer] Send invite response:", JSON.stringify(inviteData, null, 2));
    const inviteErrors = inviteData?.data?.customerSendAccountInviteEmail?.userErrors || [];
    if (inviteErrors.length > 0) {
      console.warn("[createOrUpdateShopifyCustomer] Send invite user errors:", inviteErrors);
    }
  } catch (inviteErr) {
    // Non-critical — don't block the flow
    console.warn("[createOrUpdateShopifyCustomer] Activation invite failed:", inviteErr);
  }

  return newCustomerId;
}

// ---- Helper: Create Shopify discount code ----
async function createShopifyDiscountCode(
  admin: any,
  code: string,
  customerId: string
): Promise<void> {
  // Create a basic discount code using the discountCodeBasicCreate mutation
  const startsAt = new Date().toISOString();

  const response = await admin.graphql(
    `#graphql
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                edges {
                  node {
                    code
                  }
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        basicCodeDiscount: {
          title: `Warranty 15% - ${code}`,
          code,
          startsAt,
          customerSelection: {
            all: true,
          },
          customerGets: {
            value: {
              percentage: 0.15,
            },
            items: {
              all: true,
            },
          },
          usageLimit: 1,
        },
      },
    }
  );

  const data = await response.json();
  const userErrors =
    data?.data?.discountCodeBasicCreate?.userErrors || [];

  if (userErrors.length > 0) {
    console.error("[discount] Creation errors:", userErrors);
    throw new Error(userErrors.map((e: any) => e.message).join(", "));
  }
}
