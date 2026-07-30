/**
 * Helper to determine if a product is an Electrical / Electronic appliance
 * vs non-electrical items (hand tools, utensils, cookware, accessories, car items).
 */
export function isElectricalProduct(product: {
  productType?: string;
  tags?: string[];
  title?: string;
}): boolean {
  const title = (product.title || "").toLowerCase();
  const type = (product.productType || "").toLowerCase();
  const tags = (product.tags || []).map((t) => t.toLowerCase());

  // Strict non-electrical exclusions (never electrical)
  const strictNonElectrical = [
    "sunshade", "bamboo", "hacksaw", "spanner", "hammer", "plier", "knife",
    "blade", "tape", "screw driver", "screwdriver", "wrench", "saw", "socket",
    "key tag", "glue stick", "cookware", "casserole", "frypan", "fry pan", "wok",
    "saucepan", "loaf pan", "round pan", "turner", "grater", "spoon", "ladle",
    "peeler", "bin", "dustbin", "mop", "wiper", "gloves", "apron", "airer",
    "hanger", "container", "gift card", "scouring pad", "ironing board", "oven mitt",
    "adapter", "adaptor", "lock", "booster kit", "caulking gun", "mat", "door mat",
    "towel", "cloth", "rack", "holder", "dispenser bottle", "coffee warmer", "tea warmer",
    "warmer"
  ];

  if (strictNonElectrical.some((keyword) => title.includes(keyword))) {
    // Re-verify if it's an actual powered electrical appliance like "glue gun" or "electric kettle"
    if (title.includes("vacuum cleaner") || title.includes("blender") || title.includes("electric kettle") || title.includes("clipper") || title.includes("trimmer") || title.includes("shaver") || title.includes("wax warmer") || title.includes("towel warmer")) {
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
    "vacuum", "cleaner", "blender", "kettle", "clipper", "trimmer", "grooming",
    "scale", "soundbar", "speaker", "iron", "microwave", "oven",
    "air fryer", "fryer", "juicer", "toaster", "grill", "cooker", "heater", "fan",
    "hair", "dryer", "styler", "straightener", "food processor", "chopper",
    "coffee maker", "coffee machine", "espresso", "grinder", "water dispenser", "steamer",
    "hob", "fridge", "refrigerator"
  ];

  return electricalTitleKeywords.some((k) => title.includes(k));
}
