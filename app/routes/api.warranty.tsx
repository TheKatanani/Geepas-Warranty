import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { normalizePhone } from "../utils/twilio.server";


/**
 * POST /api/warranty
 *
 * Full warranty registration flow:
 * 1. Validate input
 * 2. Normalize phone number
 * 3. Resolve or create Shopify customer (tagged "warranty-registered")
 * 4. Check reward eligibility (no stacking, no duplicates)
 * 5. Save registration + products
 * 6. Record CustomerReward row if first-time registrant
 *
 * Discount code creation and customer messaging are handled by Shopify Flow.
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
        where: { shop, phone: normalizedPhone },
      });

      // --- Save Warranty Registration ---
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

      // --- Record First-Time Reward Eligibility ---
      // Discount code creation is delegated to Shopify Flow (triggered by
      // the "warranty-registered" tag on the customer). We only track
      // eligibility here so the no-stacking rule works on subsequent registrations.
      let rewardCreated = false;
      if (!existingReward) {
        await prisma.customerReward.create({
          data: {
            shop,
            phone: normalizedPhone,
            customerId,
            rewardType: "WARRANTY_15",
            discountCode: null,
          },
        });
        rewardCreated = true;
      }

      return json(
        {
          success: true,
          registration: {
            id: registration.id,
            status: registration.status,
            productsCount: registration.products.length,
          },
          reward: rewardCreated
            ? { type: "WARRANTY_15", note: "Discount code will be sent via WhatsApp by Shopify Flow." }
            : existingReward
              ? { message: "Customer already has a reward on record." }
              : null,
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
    return json({ error: "Invalid request body." }, { status: 400 });
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
  console.log("[lookupCustomerByPhone] Shopify lookup variables:", variables);

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
  console.log("[createOrUpdateShopifyCustomer] Checking existing email:", variablesEmail);

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

    if (existing.phone !== input.phone) {
      console.log("[createOrUpdateShopifyCustomer] Updating phone for customer", existing.id, "to", input.phone);
      const mutationUpdate = `#graphql
        mutation customerUpdate($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }`;
      const variablesUpdate = {
        input: { id: existing.id, phone: input.phone, tags: ["warranty-registered"] },
      };
      const updateResponse = await admin.graphql(mutationUpdate, { variables: variablesUpdate });
      const updateData = await updateResponse.json();
      console.log("[createOrUpdateShopifyCustomer] Update response:", JSON.stringify(updateData, null, 2));

      const updateErrors = updateData?.data?.customerUpdate?.userErrors || [];
      if (updateErrors.length > 0) {
        console.error("[createOrUpdateShopifyCustomer] Update phone user errors:", updateErrors);
      }
    }

    // Always ensure the tag is present regardless of whether phone changed
    await tagCustomerWarrantyRegistered(admin, existing.id);
    return existing.id;
  }

  // Create new customer
  console.log("[createOrUpdateShopifyCustomer] Creating new customer:", input);
  const mutationCreate = `#graphql
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`;
  const variablesCreate = {
    input: {
      firstName: input.firstName,
      email: input.email,
      phone: input.phone,
      tags: ["warranty-registered"],
    },
  };

  const createResponse = await admin.graphql(mutationCreate, { variables: variablesCreate });
  const createData = await createResponse.json();
  console.log("[createOrUpdateShopifyCustomer] Create response:", JSON.stringify(createData, null, 2));

  const userErrors = createData?.data?.customerCreate?.userErrors || [];
  if (userErrors.length > 0) {
    console.error("[createOrUpdateShopifyCustomer] Customer creation user errors:", userErrors);
    console.log("[createOrUpdateShopifyCustomer] Falling back to phone lookup:", input.phone);
    const fallbackId = await lookupCustomerByPhone(admin, input.phone);
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

  console.log("[createOrUpdateShopifyCustomer] Customer created. ID:", newCustomerId);

  // Send activation email invite
  try {
    const mutationInvite = `#graphql
      mutation customerSendAccountInviteEmail($customerId: ID!) {
        customerSendAccountInviteEmail(customerId: $customerId) {
          customer { id }
          userErrors { field message }
        }
      }`;
    const inviteResponse = await admin.graphql(mutationInvite, { variables: { customerId: newCustomerId } });
    const inviteData = await inviteResponse.json();
    const inviteErrors = inviteData?.data?.customerSendAccountInviteEmail?.userErrors || [];
    if (inviteErrors.length > 0) {
      console.warn("[createOrUpdateShopifyCustomer] Send invite user errors:", inviteErrors);
    }
  } catch (inviteErr) {
    console.warn("[createOrUpdateShopifyCustomer] Activation invite failed (non-critical):", inviteErr);
  }

  return newCustomerId;
}

// ---- Helper: Ensure warranty-registered tag is on the customer ----
// Uses tagsAdd so it never overwrites existing tags.
async function tagCustomerWarrantyRegistered(
  admin: any,
  customerId: string
): Promise<void> {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation tagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
      { variables: { id: customerId, tags: ["warranty-registered"] } }
    );
    const data = await response.json();
    const errors = data?.data?.tagsAdd?.userErrors || [];
    if (errors.length > 0) {
      console.warn("[tagCustomerWarrantyRegistered] userErrors:", errors);
    }
  } catch (err) {
    console.warn("[tagCustomerWarrantyRegistered] Failed (non-critical):", err);
  }
}
