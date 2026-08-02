import { normalizePhone, phoneSearchSuffix } from "./phone.server";

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
    const searchConditions: any[] = [
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

    // If search contains digits, also match bare national digits and normalized phone numbers
    const digitsOnly = search.replace(/\D/g, "");
    if (digitsOnly.length >= 3) {
      const bareDigits = digitsOnly.startsWith("0") ? digitsOnly.slice(1) : digitsOnly;
      if (bareDigits.length >= 3) {
        searchConditions.push({ phone: { contains: bareDigits } });
      }
      const normalized = normalizePhone(search);
      if (normalized) {
        searchConditions.push({ phone: { contains: normalized } });
      }
    }

    where.OR = searchConditions;
  }

  if (phone) {
    const digitsOnly = phone.replace(/\D/g, "");
    const phoneConditions: any[] = [];

    const bareDigits = digitsOnly.startsWith("0") ? digitsOnly.slice(1) : digitsOnly;
    if (bareDigits.length >= 3) {
      phoneConditions.push({ phone: { contains: bareDigits } });
    }

    const normalized = normalizePhone(phone);
    if (normalized) {
      phoneConditions.push({ phone: { contains: normalized } });
    }

    const phoneSuffix = phoneSearchSuffix(phone);
    if (phoneSuffix) {
      phoneConditions.push({ phone: { endsWith: phoneSuffix } });
    }

    if (phoneConditions.length > 0) {
      if (where.OR) {
        const searchOR = where.OR;
        delete where.OR;
        where.AND = [{ OR: searchOR }, { OR: phoneConditions }];
      } else {
        where.OR = phoneConditions;
      }
    }
  }

  return where;
}
