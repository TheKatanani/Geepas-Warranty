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
