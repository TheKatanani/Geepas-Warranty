/**
 * Helper to determine if a product is an Electrical / Electronic appliance
 * vs non-electrical items (hand tools, utensils, cookware, accessories).
 */
export function isElectricalProduct(product: {
  productType?: string;
  tags?: string[];
  title?: string;
}): boolean {
  const title = (product.title || "").toLowerCase();
  const type = (product.productType || "").toLowerCase();
  const tags = (product.tags || []).map((t) => t.toLowerCase());

  // Non-electrical exclusions (override matching keywords like "ironing board" or "oven mitt")
  const nonElectricalExceptions = [
    "ironing board", "oven mitt", "glass container", "airtight container",
    "bamboo", "nylon", "silicone spoon", "silicone rice spoon", "scouring pad",
    "hacksaw", "spanner", "hammer", "plier", "knife", "blade", "tape", "screw driver",
    "screwdriver", "wrench", "saw", "socket", "key tag", "glue stick", "cookware",
    "casserole", "frypan", "fry pan", "wok", "saucepan", "loaf pan", "round pan",
    "turner", "grater", "spoon", "ladle", "peeler", "bin", "dustbin", "mop", "wiper",
    "gloves", "apron", "airer", "hanger", "gift card"
  ];

  if (nonElectricalExceptions.some((exc) => title.includes(exc))) {
    // Re-verify if it's actually an electrical item like "glue gun" or "electric kettle"
    if (title.includes("vacuum cleaner") || title.includes("blender") || title.includes("electric kettle") || title.includes("clipper") || title.includes("trimmer") || title.includes("grooming")) {
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

  // Title keywords for electrical / electronic products
  const electricalTitleKeywords = [
    "vacuum cleaner", "blender", "kettle", "clipper", "trimmer", "grooming",
    "personal scale", "soundbar", "speaker", "steam iron", "dry iron", "microwave",
    "air fryer", "juicer", "toaster", "grill", "cooker", "heater", "fan", "hair dryer",
    "food processor", "chopper", "coffee maker", "water dispenser"
  ];

  return electricalTitleKeywords.some((k) => title.includes(k));
}
