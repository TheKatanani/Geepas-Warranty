import { describe, expect, it } from "vitest";
import {
  BASE_WARRANTY_VALUE,
  EXTENDED_WARRANTY_VALUE,
  WARRANTY_OPTION_NAME,
  WARRANTY_SURCHARGE_MULTIPLIER,
  calculateWarrantyPrice,
  shouldUpdateWarrantyPrice,
} from "./warranty-pricing.server";

describe("Warranty Pricing Utility (Phase 3 & Float Rounding Fix)", () => {
  describe("Constants", () => {
    it("has correct warranty option configuration", () => {
      expect(WARRANTY_OPTION_NAME).toBe("Warranty");
      expect(BASE_WARRANTY_VALUE).toBe("2 Years(Free)");
      expect(EXTENDED_WARRANTY_VALUE).toBe("3 Years");
      expect(WARRANTY_SURCHARGE_MULTIPLIER).toBe(1.15);
    });
  });

  describe("calculateWarrantyPrice — Float Precision & Rounding Fixes", () => {
    it("correctly rounds 3250 * 1.15 to 3738 (regression test for float precision drift)", () => {
      // 3250 * 1.15 = 3737.5. Standard JS float drift makes 3250 * 1.15 = 3737.4999999999995.
      // Must round to 3738.
      expect(calculateWarrantyPrice(3250)).toBe(3738);
      expect(calculateWarrantyPrice("3250")).toBe(3738);
      expect(calculateWarrantyPrice("3250.00")).toBe(3738);
    });

    it("correctly calculates known float-precision-prone inputs at .5 boundaries", () => {
      // 1750 * 1.15 = 2012.5 -> rounds to 2013
      expect(calculateWarrantyPrice(1750)).toBe(2013);
      // 2250 * 1.15 = 2587.5 -> rounds to 2588
      expect(calculateWarrantyPrice(2250)).toBe(2588);
      // 5250 * 1.15 = 6037.5 -> rounds to 6038
      expect(calculateWarrantyPrice(5250)).toBe(6038);
      // 9250 * 1.15 = 10637.5 -> rounds to 10638
      expect(calculateWarrantyPrice(9250)).toBe(10638);
    });

    it("re-confirms all previously passing baseline cases", () => {
      // 5500 * 1.15 = 6325
      expect(calculateWarrantyPrice(5500)).toBe(6325);
      // 7250 * 1.15 = 8337.5 -> 8338
      expect(calculateWarrantyPrice(7250)).toBe(8338);
      // 8750 * 1.15 = 10062.5 -> 10063
      expect(calculateWarrantyPrice(8750)).toBe(10063);
      // 3000 * 1.15 = 3450
      expect(calculateWarrantyPrice(3000)).toBe(3450);
      // 45000 * 1.15 = 51750
      expect(calculateWarrantyPrice(45000)).toBe(51750);
      // 12500 * 1.15 = 14375
      expect(calculateWarrantyPrice(12500)).toBe(14375);
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
      // Base: 3250 -> Expected 3Yr: 3738
      expect(shouldUpdateWarrantyPrice(3250, 3738)).toBe(false);
    });

    it("returns true when current 3-year variant price is out of sync with base price", () => {
      // Base: 3250 -> Expected 3Yr: 3738. Current is old price 3737 (buggy round)
      expect(shouldUpdateWarrantyPrice(3250, 3737)).toBe(true);
      // Base: 50,000 -> Expected 3Yr: 57,500. Current is old price 51,750
      expect(shouldUpdateWarrantyPrice(50000, 51750)).toBe(true);
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
