/**
 * Pure utility functions for calculating 3-Year Extended Warranty pricing
 * and determining if a variant price update is required (loop-guard).
 */

export const WARRANTY_OPTION_NAME = "Warranty";
export const BASE_WARRANTY_VALUE = "1 Year (Standard)";
export const EXTENDED_WARRANTY_VALUE = "3 Years";
export const WARRANTY_SURCHARGE_MULTIPLIER = 1.15;

/**
 * Calculates the static price for the 3-Year Extended Warranty variant.
 * Formula: Math.round(basePrice * 1.15)
 * IQD pricing is represented as whole numbers.
 */
export function calculateWarrantyPrice(basePrice: number | string): number {
  const numericBasePrice = typeof basePrice === "string" ? parseFloat(basePrice) : basePrice;
  if (isNaN(numericBasePrice) || numericBasePrice <= 0) {
    return 0;
  }
  return Math.round(numericBasePrice * WARRANTY_SURCHARGE_MULTIPLIER);
}

/**
 * Pure Loop-Guard:
 * Compares expected 3-year warranty price against current 3-year variant price.
 * Returns true ONLY if an update is needed (i.e. prices differ or 3-year price missing).
 * Prevents recursive webhook triggering when Shopify price sync updates variants.
 */
export function shouldUpdateWarrantyPrice(
  basePrice: number | string,
  current3YrPrice: number | string | null | undefined,
): boolean {
  if (current3YrPrice == null) {
    return true;
  }

  const expectedPrice = calculateWarrantyPrice(basePrice);
  if (expectedPrice <= 0) {
    return false;
  }

  const numericCurrentPrice =
    typeof current3YrPrice === "string" ? parseFloat(current3YrPrice) : current3YrPrice;

  if (isNaN(numericCurrentPrice)) {
    return true;
  }

  // Returns true if expected price does NOT equal current price
  return Math.round(numericCurrentPrice) !== expectedPrice;
}
