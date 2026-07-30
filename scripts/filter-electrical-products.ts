import { unauthenticated } from "../app/shopify.server";

export function isElectricalProduct(product: { productType?: string; tags?: string[]; title?: string }): boolean {
  const type = (product.productType || "").toLowerCase();
  const tags = (product.tags || []).map((t) => t.toLowerCase());
  const title = (product.title || "").toLowerCase();

  // Explicit non-electrical keywords to reject
  const nonElectricalKeywords = [
    "spanner", "hammer", "plier", "utility knife", "scraper", "screwdriver", "tape",
    "wrench", "saw", "socket", "key tag", "glue gun", "glue stick", "cookware",
    "casserole", "frypan", "fry pan", "wok", "saucepan", "loaf pan", "round pan",
    "turner", "grater", "spoon", "ladle", "peeler", "knife", "scouring pad", "hacksaw",
    "adapter", "lock", "booster kit", "sunshade", "caulking gun", "bin", "dustbin",
    "mop", "wiper", "gloves", "apron", "airer", "hanger", "container", "gift card"
  ];

  // If title or type contains explicit non-electrical items
  if (nonElectricalKeywords.some((k) => title.includes(k))) {
    // Check if it's an electrical appliance like "glue gun", "personal blender", "vacuum cleaner"
    if (title.includes("vacuum cleaner") || title.includes("blender") || title.includes("kettle") || title.includes("clipper") || title.includes("trimmer") || title.includes("grooming")) {
      return true;
    }
    return false;
  }

  if (type.includes("electrical") || type.includes("appliance") || type.includes("electronics")) {
    return true;
  }

  if (tags.some((t) => t === "electrical" || t.includes("electrical") || t === "appliance")) {
    return true;
  }

  // Electrical appliance title keywords
  const electricalTitleKeywords = [
    "vacuum cleaner", "blender", "kettle", "clipper", "trimmer", "grooming",
    "personal scale", "soundbar", "speaker", "iron", "oven", "microwave",
    "air fryer", "juicer", "toaster", "grill", "cooker", "heater", "fan"
  ];

  return electricalTitleKeywords.some((k) => title.includes(k));
}

async function main() {
  const shop = "ae53cd-2.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  let hasNextPage = true;
  let cursor: string | null = null;
  let electricalCount = 0;
  let nonElectricalCount = 0;
  const electricalList: any[] = [];
  const nonElectricalList: any[] = [];

  while (hasNextPage) {
    const res: any = await admin.graphql(`#graphql
      query getProductsForCheck($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            productType
            tags
            status
            options {
              id
              name
              optionValues {
                id
                name
              }
            }
            variants(first: 10) {
              nodes {
                id
                title
              }
            }
          }
        }
      }
    `, { variables: { first: 50, after: cursor } });

    const data = await res.json();
    const nodes = data?.data?.products?.nodes || [];

    for (const p of nodes) {
      if (p.status !== "ACTIVE") continue;
      const isElec = isElectricalProduct(p);
      if (isElec) {
        electricalCount++;
        electricalList.push(p.title);
      } else {
        nonElectricalCount++;
        nonElectricalList.push(p.title);
      }
    }

    hasNextPage = Boolean(data?.data?.products?.pageInfo?.hasNextPage);
    cursor = data?.data?.products?.pageInfo?.endCursor || null;
  }

  console.log(`Active Electrical Products: ${electricalCount}`);
  console.log(`Active Non-Electrical Products: ${nonElectricalCount}`);
  console.log("\nSample Electrical Products:", electricalList.slice(0, 15));
  console.log("\nSample Non-Electrical Products:", nonElectricalList.slice(0, 15));
}

main().catch(console.error);
