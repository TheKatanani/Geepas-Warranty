import { phoneSearchSuffix } from "./phone.server";

export interface RegistrationFilterParams {
  search?: string | null;
  status?: string | null;
  phone?: string | null;
}

/**
 * Builds the Prisma `where` clause for warranty registrations, shared between
 * the admin list page and the export route so the two never drift apart.
 */
export function buildRegistrationWhere(
  shop: string,
  { search, status, phone }: RegistrationFilterParams,
): any {
  const where: any = { shop };

  if (status && status !== "all") {
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

  const phoneSuffix = phone ? phoneSearchSuffix(phone) : null;
  if (phoneSuffix) {
    where.phone = { endsWith: phoneSuffix };
  }

  return where;
}
