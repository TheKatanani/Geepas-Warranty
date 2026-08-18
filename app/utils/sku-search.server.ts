/**
 * Shopify's search query syntax treats these characters as syntax, not
 * literal SKU characters — strip them defensively even though real SKUs
 * shouldn't contain them.
 */
export function escapeQueryTerm(term: string): string {
  return term.replace(/["():]/g, "");
}

/**
 * SKUs on the physical box often have dashes/spaces the store data may lack
 * (or vice versa), so callers search both the raw and the stripped form.
 * Returns a deduped, order-preserving list (raw first, then stripped if
 * different).
 */
export function skuSearchTerms(raw: string): string[] {
  const trimmed = raw.trim().toUpperCase();
  const stripped = trimmed.replace(/[\s-]/g, "");
  return Array.from(new Set([trimmed, stripped].filter(Boolean)));
}

export function variantDisplayTitle(
  title: string | null | undefined,
): string | null {
  return title && title !== "Default Title" ? title : null;
}

export const ARABIC_PRODUCT_SEARCH_MAP: Record<string, string> = {
  "خلاط": "blender",
  "خلاطة": "blender",
  "خلاطه": "blender",
  "بلندر": "blender",
  "عصارة": "juicer",
  "عصاره": "juicer",
  "عصير": "juicer",
  "خفاقة": "hand mixer",
  "خفاقه": "hand mixer",
  "عجانة": "stand mixer",
  "عجانه": "stand mixer",
  "عجان": "stand mixer",
  "هاند بلندر": "hand blender",
  "خلاط يدوي": "hand blender",
  "مكنسة": "vacuum cleaner",
  "مكنسه": "vacuum cleaner",
  "مكانس": "vacuum cleaner",
  "مكنسة كهربائية": "vacuum cleaner",
  "مكنسة برميل": "drum vacuum cleaner",
  "مكنسة عمودية": "stick vacuum cleaner",
  "مكنسة شحن": "cordless vacuum cleaner",
  "مكنسة سيارة": "car vacuum cleaner",
  "مكواة": "steam iron",
  "مكواه": "steam iron",
  "كواية": "steam iron",
  "كوايه": "steam iron",
  "كواية بخار": "steam iron",
  "مكواة بخار": "steam iron",
  "كواية عمودية": "garment steamer",
  "مكواة عمودية": "garment steamer",
  "بخار": "steamer",
  "ستيمر": "garment steamer",
  "اوتي": "steam iron",
  "قلاية": "air fryer",
  "قلايه": "air fryer",
  "قلاية هوائية": "air fryer",
  "قلايه هوائيه": "air fryer",
  "مقلاة": "air fryer",
  "ايرفراير": "air fryer",
  "غلاية": "electric kettle",
  "غلايه": "electric kettle",
  "كتل": "electric kettle",
  "غلاية ماء": "electric kettle",
  "غلاية زجاج": "glass kettle",
  "قهوة": "coffee maker",
  "قهوه": "coffee maker",
  "صانعة قهوة": "coffee maker",
  "ماكينة قهوة": "coffee maker",
  "قهوة تركية": "turkish coffee maker",
  "اسبريسو": "espresso",
  "مايكرويف": "microwave oven",
  "ميكرويف": "microwave oven",
  "فرن": "oven",
  "طباخ": "infrared cooker",
  "طباخ ليزري": "infrared cooker",
  "طباخ كهربائي": "infrared cooker",
  "طباخ ضغط": "multi cooker",
  "طباخ ارز": "rice cooker",
  "مفرمة": "meat grinder",
  "مفرمه": "meat grinder",
  "ثرامة": "meat grinder",
  "ثرامه": "meat grinder",
  "ثرامة لحم": "meat grinder",
  "قطاعة": "multi chopper",
  "محضرة طعام": "food processor",
  "شواية": "grill maker",
  "صانعة سندويش": "grill maker",
  "توستر": "bread toaster",
  "سشوار": "hair dryer",
  "مجفف شعر": "hair dryer",
  "ستريتنر": "hair straightener",
  "كاوية شعر": "hair straightener",
  "حلاقة": "trimmer",
  "ماكينة حلاقة": "trimmer",
  "ثلاجة": "refrigerator",
  "براد": "water dispenser",
  "موزع ماء": "water dispenser",
  "كشاف": "flashlight",
  "مصباح": "flashlight",
  "لايت": "flashlight",
  "مروحة": "fan",
  "مدفأة": "heater",
  "صوبة": "heater",
  "دفاية": "heater",
  "ميزان": "digital kitchen scale",
  "سماعة": "speaker",
  "سبيكر": "speaker",
};

export function translateArabicQuery(term: string): string {
  if (!term) return "";
  const cleaned = term.trim().toLowerCase();
  if (ARABIC_PRODUCT_SEARCH_MAP[cleaned]) {
    return ARABIC_PRODUCT_SEARCH_MAP[cleaned];
  }
  const keys = Object.keys(ARABIC_PRODUCT_SEARCH_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (cleaned.includes(k)) {
      return ARABIC_PRODUCT_SEARCH_MAP[k];
    }
  }
  return "";
}
