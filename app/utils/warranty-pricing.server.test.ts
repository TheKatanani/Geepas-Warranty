import { describe, expect, it } from "vitest";
import {
  BASE_WARRANTY_VALUE,
  EXTENDED_WARRANTY_VALUE,
  WARRANTY_OPTION_NAME,
  WARRANTY_SURCHARGE_MULTIPLIER,
  calculateWarrantyPrice,
  shouldUpdateWarrantyPrice,
} from "./warranty-pricing.server";

describe("Warranty Pricing Utility (Phase 3)", () => {
  describe("Constants", () => {
    it("has correct warranty option configuration", () => {
      expect(WARRANTY_OPTION_NAME).toBe("Warranty");
      expect(BASE_WARRANTY_VALUE).toBe("1 Year (Standard)");
      expect(EXTENDED_WARRANTY_VALUE).toBe("3 Years");
      expect(WARRANTY_SURCHARGE_MULTIPLIER).toBe(1.15);
    });
  });

  describe("calculateWarrantyPrice", () => {
    it("calculates 15% surcharge rounded for standard IQD prices", () => {
      // 45,000 * 1.15 = 51,750
      expect(calculateWarrantyPrice(45000)).toBe(51750);
      expect(calculateWarrantyPrice("45000")).toBe(51750);
      expect(calculateWarrantyPrice("45000.00")).toBe(51750);
    });

    it("handles non-integer base price calculations with proper rounding", () => {
      // 12,500 * 1.15 = 14,375
      expect(calculateWarrantyPrice(12500)).toBe(14375);

      // 33,333 * 1.15 = 38,332.95 -> 38333
      expect(calculateWarrantyPrice(33333)).toBe(38333);
    });

    it("returns 0 for invalid or non-positive base prices", () => {
      expect(calculateWarrantyPrice(0)).toBe(0);
      expect(calculateWarrantyPrice(-100)).toBe(0);
      expect(calculateWarrantyPrice("invalid")).toBe(0);
    });
  });

  describe("shouldUpdateWarrantyPrice (Loop-Guard)", () => {
    it("returns false when current 3-year variant price matches expected price exactly", () => {
      // Base: 45,000 -> Expected 3Yr: 51,750
      expect(shouldUpdateWarrantyPrice(45000, 51750)).toBe(false);
      expect(shouldUpdateWarrantyPrice("45000", "51750")).toBe(false);
      expect(shouldUpdateWarrantyPrice("45000.00", "51750.00")).toBe(false);
    });

    it("returns true when current 3-year variant price is out of sync with base price", () => {
      // Base: 50,000 -> Expected 3Yr: 57,500. Current is old price 51,750
      expect(shouldUpdateWarrantyPrice(50000, 51750)).toBe(true);
      expect(shouldUpdateWarrantyPrice("50000", "51750")).toBe(true);
    });

    it("returns true when 3-year variant price is null, undefined, or invalid", () => {
      expect(shouldUpdateWarrantyPrice(45000, null)).toBe(true);
      expect(shouldUpdateWarrantyPrice(45000, undefined)).toBe(true);
      expect(shouldUpdateWarrantyPrice(45000, "invalid")).toBe(true);
    });

    it("returns false if base price is invalid or <= 0", () => {
      expect(shouldUpdateWarrantyPrice(0, 100)).toBe(false);
      expect(shouldUpdateWarrantyPrice("invalid", 100)).toBe(false);
    });
  });
});
