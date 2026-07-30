/**
 * Pure utility functions for calculating 3-Year Extended Warranty pricing
 * and determining if a variant price update is required (loop-guard).
 */

export const WARRANTY_OPTION_NAME = "Warranty";
export const BASE_WARRANTY_VALUE = "2 Years(Free)";
export const EXTENDED_WARRANTY_VALUE = "3 Years";
export const WARRANTY_SURCHARGE_MULTIPLIER = 1.15;

/**
 * Calculates the static price for the 3-Year Extended Warranty variant.
 * Formula: Math.round(basePrice * 1.15)
 *
 * Uses scaled integer arithmetic (fils/cents x100) to eliminate IEEE 754
 * floating-point drift on .5 boundary values (e.g. 3250 * 1.15 = 3737.5
 * which JS floats represent as 3737.4999999999995 causing Math.round to return 3737).
 */
export function calculateWarrantyPrice(basePrice: number | string): number {
  const numericBasePrice = typeof basePrice === "string" ? parseFloat(basePrice) : basePrice;
  if (isNaN(numericBasePrice) || numericBasePrice <= 0) {
    return 0;
  }
  // Convert to integer units (x100) to avoid float representation errors on half-integer boundaries
  const integerBase = Math.round(numericBasePrice * 100);
  return Math.round((integerBase * 115) / 10000);
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
