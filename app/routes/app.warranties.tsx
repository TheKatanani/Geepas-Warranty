import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  IndexFilters,
  useSetIndexFiltersMode,
  useIndexResourceState,
  EmptySearchResult,
  Modal,
  BlockStack,
  InlineStack,
  Button,
  Divider,
  Tag,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ---------- Loader ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "all";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = 20;

  // Build where clause — always scoped to current shop
  const where: any = { shop };

  if (status !== "all") {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } },
      { invoiceNumber: { contains: search } },
      { city: { contains: search } },
      { store: { contains: search } },
      {
        products: {
          some: { productTitle: { contains: search } },
        },
      },
    ];
  }

  const [registrations, total] = await Promise.all([
    prisma.warrantyRegistration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        products: true,
        smsLogs: { orderBy: { smsSentAt: "desc" }, take: 1 },
      },
    }),
    prisma.warrantyRegistration.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  // Fetch rewards for phone numbers in this page
  const phones = [...new Set(registrations.map((r) => r.phone))];
  const rewards =
    phones.length > 0
      ? await prisma.customerReward.findMany({
          where: { shop, phone: { in: phones } },
        })
      : [];

  return json({
    registrations: registrations.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      purchaseDate: r.purchaseDate.toISOString(),
      smsLogs: r.smsLogs.map((s) => ({
        ...s,
        smsSentAt: s.smsSentAt?.toISOString() || null,
      })),
    })),
    rewards: rewards.map((r) => ({
      ...r,
      issuedAt: r.issuedAt.toISOString(),
      sentAt: r.sentAt?.toISOString() || null,
    })),
    total,
    page,
    totalPages,
    search,
    status,
  });
};

// ---------- Action (status updates) ----------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const newStatus = formData.get("status") as string;

  if (!id || !newStatus) {
    return json({ error: "Missing fields" }, { status: 400 });
  }

  // Ensure the registration belongs to this shop
  const registration = await prisma.warrantyRegistration.findFirst({
    where: { id, shop },
  });

  if (!registration) {
    return json({ error: "Registration not found" }, { status: 404 });
  }

  await prisma.warrantyRegistration.update({
    where: { id },
    data: { status: newStatus },
  });

  return json({ success: true });
};

// ---------- Component ----------
export default function WarrantiesPage() {
  const { registrations, rewards, total, page, totalPages, search, status } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();

  // Search & filter state
  const [queryValue, setQueryValue] = useState(search);
  const [statusFilter, setStatusFilter] = useState(status);

  // Detail modal state
  const [selectedReg, setSelectedReg] = useState<
    (typeof registrations)[number] | null
  >(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const { mode, setMode } = useSetIndexFiltersMode();

  const resourceName = {
    singular: "registration",
    plural: "registrations",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(registrations);

  // ---------- Handlers ----------
  const handleSearch = useCallback((value: string) => {
    setQueryValue(value);
  }, []);

  const handleSearchClear = useCallback(() => {
    setQueryValue("");
    const params = new URLSearchParams(searchParams);
    params.delete("search");
    params.set("page", "1");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleSearchSubmit = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (queryValue) {
      params.set("search", queryValue);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [queryValue, searchParams, setSearchParams]);

  const handleStatusChange = useCallback(
    (value: string) => {
      setStatusFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value === "all") {
        params.delete("status");
      } else {
        params.set("status", value);
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleStatusUpdate = useCallback(
    (id: string, newStatus: string) => {
      const formData = new FormData();
      formData.set("id", id);
      formData.set("status", newStatus);
      submit(formData, { method: "post" });

      // Optimistically update the selected registration in the modal
      if (selectedReg && selectedReg.id === id) {
        setSelectedReg({ ...selectedReg, status: newStatus });
      }
    },
    [submit, selectedReg]
  );

  const handlePagination = useCallback(
    (direction: "next" | "prev") => {
      const newPage = direction === "next" ? page + 1 : page - 1;
      const params = new URLSearchParams(searchParams);
      params.set("page", String(newPage));
      setSearchParams(params);
    },
    [page, searchParams, setSearchParams]
  );

  // ---------- Helpers ----------
  const statusBadge = (s: string) => {
    switch (s) {
      case "approved":
        return <Badge tone="success">Approved</Badge>;
      case "rejected":
        return <Badge tone="critical">Rejected</Badge>;
      default:
        return <Badge tone="attention">Pending</Badge>;
    }
  };

  const getRewardsForPhone = (phone: string) =>
    rewards.filter((r) => r.phone === phone);

  const rewardTypeBadge = (type: string) => {
    switch (type) {
      case "WELCOME_10":
        return <Badge tone="info">Welcome 10%</Badge>;
      case "WARRANTY_15":
        return <Badge tone="success">Warranty 15%</Badge>;
      default:
        return <Badge>{type}</Badge>;
    }
  };

  // ---------- Table rows ----------
  const rowMarkup = registrations.map((reg, index) => {
    const productNames = reg.products
      .map((p) => p.productTitle)
      .join(", ");
    const truncatedProducts =
      productNames.length > 40
        ? productNames.slice(0, 40) + "…"
        : productNames;

    return (
      <IndexTable.Row
        id={reg.id}
        key={reg.id}
        selected={selectedResources.includes(reg.id)}
        position={index}
        onClick={() => {
          setSelectedReg(reg);
          setDetailModalOpen(true);
        }}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {reg.firstName}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{reg.phone}</IndexTable.Cell>
        <IndexTable.Cell>{reg.email}</IndexTable.Cell>
        <IndexTable.Cell>{reg.city}</IndexTable.Cell>
        <IndexTable.Cell>{reg.store}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodySm" as="span">
            {truncatedProducts}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{reg.invoiceNumber || "—"}</IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(reg.purchaseDate).toLocaleDateString()}
        </IndexTable.Cell>
        <IndexTable.Cell>{statusBadge(reg.status)}</IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(reg.createdAt).toLocaleDateString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const emptyState = (
    <EmptySearchResult
      title="No warranty registrations found"
      description="Try changing the filters or search term"
      withIllustration
    />
  );

  // ---------- Filter tabs ----------
  const tabs = [
    { id: "all", content: "All", accessibilityLabel: "All registrations" },
    { id: "pending", content: "Pending" },
    { id: "approved", content: "Approved" },
    { id: "rejected", content: "Rejected" },
  ];

  const selectedTab = tabs.findIndex((t) => t.id === statusFilter);

  // ---------- Selected reg rewards ----------
  const selectedRegRewards = selectedReg
    ? getRewardsForPhone(selectedReg.phone)
    : [];

  return (
    <Page
      title="Warranty Registrations"
      subtitle={`${total} total registrations`}
      fullWidth
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexFilters
              queryValue={queryValue}
              queryPlaceholder="Search by name, email, phone, city, product..."
              onQueryChange={handleSearch}
              onQueryClear={handleSearchClear}
              tabs={tabs}
              selected={selectedTab >= 0 ? selectedTab : 0}
              onSelect={(index) => handleStatusChange(tabs[index].id)}
              filters={[]}
              onClearAll={() => {}}
              mode={mode}
              setMode={setMode}
              cancelAction={{
                onAction: () => {},
              }}
            />
            <IndexTable
              resourceName={resourceName}
              itemCount={registrations.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Name" },
                { title: "Phone" },
                { title: "Email" },
                { title: "City" },
                { title: "Store" },
                { title: "Products" },
                { title: "Invoice #" },
                { title: "Purchase Date" },
                { title: "Status" },
                { title: "Submitted" },
              ]}
              emptyState={emptyState}
              pagination={{
                hasNext: page < totalPages,
                hasPrevious: page > 1,
                onNext: () => handlePagination("next"),
                onPrevious: () => handlePagination("prev"),
              }}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      {/* ---------- Detail Modal ---------- */}
      {selectedReg && (
        <Modal
          open={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          title="Registration Details"
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* Customer Info */}
              <Text as="h3" variant="headingMd">
                Customer Information
              </Text>
              <InlineStack gap="400" wrap>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Name
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {selectedReg.firstName}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Email
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {selectedReg.email}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Phone
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {selectedReg.phone}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Shopify Customer
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {selectedReg.customerId}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Purchase Info */}
              <Text as="h3" variant="headingMd">
                Purchase Details
              </Text>
              <InlineStack gap="400" wrap>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    City
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {selectedReg.city}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Store
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {selectedReg.store}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Purchase Date
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {new Date(selectedReg.purchaseDate).toLocaleDateString()}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Invoice #
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {selectedReg.invoiceNumber || "Not provided"}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Products */}
              <Text as="h3" variant="headingMd">
                Products ({selectedReg.products.length})
              </Text>
              <BlockStack gap="200">
                {selectedReg.products.map((p) => (
                  <InlineStack key={p.id} gap="200" align="start" blockAlign="center">
                    <Tag>
                      {p.isManual ? "Manual" : "Catalog"}
                    </Tag>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {p.productTitle}
                    </Text>
                    {p.sku && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        SKU: {p.sku}
                      </Text>
                    )}
                  </InlineStack>
                ))}
              </BlockStack>

              <Divider />

              {/* Rewards */}
              <Text as="h3" variant="headingMd">
                Customer Rewards
              </Text>
              {selectedRegRewards.length > 0 ? (
                <BlockStack gap="200">
                  {selectedRegRewards.map((r) => (
                    <InlineStack key={r.id} gap="300" align="start" blockAlign="center">
                      {rewardTypeBadge(r.rewardType)}
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {r.discountCode}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Issued{" "}
                        {new Date(r.issuedAt).toLocaleDateString()}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              ) : (
                <Text as="span" variant="bodySm" tone="subdued">
                  No rewards issued for this customer.
                </Text>
              )}

              <Divider />

              {/* SMS Status */}
              <Text as="h3" variant="headingMd">
                SMS Status
              </Text>
              {selectedReg.smsLogs && selectedReg.smsLogs.length > 0 ? (
                <InlineStack gap="200" align="start" blockAlign="center">
                  <Badge
                    tone={
                      selectedReg.smsLogs[0].smsSent
                        ? "success"
                        : "critical"
                    }
                  >
                    {selectedReg.smsLogs[0].smsSent ? "Sent" : "Failed"}
                  </Badge>
                  {selectedReg.smsLogs[0].smsSentAt && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {new Date(
                        selectedReg.smsLogs[0].smsSentAt
                      ).toLocaleString()}
                    </Text>
                  )}
                </InlineStack>
              ) : (
                <Text as="span" variant="bodySm" tone="subdued">
                  No SMS logs.
                </Text>
              )}

              <Divider />

              {/* Status + Actions */}
              <Text as="h3" variant="headingMd">
                Status
              </Text>
              <InlineStack gap="300" align="start" blockAlign="center">
                {statusBadge(selectedReg.status)}
                <Text as="span" variant="bodySm" tone="subdued">
                  Submitted{" "}
                  {new Date(selectedReg.createdAt).toLocaleString()}
                </Text>
              </InlineStack>

              <InlineStack gap="300">
                {selectedReg.status !== "approved" && (
                  <Button
                    variant="primary"
                    tone="success"
                    onClick={() =>
                      handleStatusUpdate(selectedReg.id, "approved")
                    }
                  >
                    Approve
                  </Button>
                )}
                {selectedReg.status !== "rejected" && (
                  <Button
                    variant="primary"
                    tone="critical"
                    onClick={() =>
                      handleStatusUpdate(selectedReg.id, "rejected")
                    }
                  >
                    Reject
                  </Button>
                )}
                {selectedReg.status !== "pending" && (
                  <Button
                    onClick={() =>
                      handleStatusUpdate(selectedReg.id, "pending")
                    }
                  >
                    Reset to Pending
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
