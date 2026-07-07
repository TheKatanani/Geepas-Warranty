import { describe, it, expect } from "vitest";
import {
  escapeQueryTerm,
  skuSearchTerms,
  variantDisplayTitle,
} from "./sku-search.server";

describe("skuSearchTerms", () => {
  it("uppercases the input", () => {
    expect(skuSearchTerms("ga-1234")).toContain("GA-1234");
  });

  it("trims surrounding whitespace", () => {
    expect(skuSearchTerms("  GA-1234  ")).toContain("GA-1234");
  });

  it("includes a dash/space-stripped variant alongside the raw form", () => {
    expect(skuSearchTerms("GA-1234")).toEqual(
      expect.arrayContaining(["GA-1234", "GA1234"]),
    );
  });

  it("strips internal spaces in the stripped variant", () => {
    expect(skuSearchTerms("GA 1234")).toEqual(
      expect.arrayContaining(["GA 1234", "GA1234"]),
    );
  });

  it("dedupes when the raw and stripped forms are identical", () => {
    expect(skuSearchTerms("GA1234")).toEqual(["GA1234"]);
  });

  it("returns no terms for an empty/whitespace-only input", () => {
    expect(skuSearchTerms("   ")).toEqual([]);
  });
});

describe("escapeQueryTerm", () => {
  it("strips characters with special meaning in Shopify's search syntax", () => {
    expect(escapeQueryTerm('GA"1234)(:')).toBe("GA1234");
  });

  it("leaves ordinary SKU characters untouched", () => {
    expect(escapeQueryTerm("GA-1234_A")).toBe("GA-1234_A");
  });
});

describe("variantDisplayTitle", () => {
  it("hides Shopify's synthetic 'Default Title' for single-variant products", () => {
    expect(variantDisplayTitle("Default Title")).toBeNull();
  });

  it("passes through a real variant title", () => {
    expect(variantDisplayTitle("5L / Black")).toBe("5L / Black");
  });

  it("treats null/undefined as no title", () => {
    expect(variantDisplayTitle(null)).toBeNull();
    expect(variantDisplayTitle(undefined)).toBeNull();
  });
});
