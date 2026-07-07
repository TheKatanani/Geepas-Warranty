import { describe, it, expect } from "vitest";
import { normalizePhone, phoneSearchSuffix } from "./phone.server";

describe("normalizePhone", () => {
  it("converts a leading-0 Iraqi local number to E.164", () => {
    expect(normalizePhone("07701234567")).toBe("+9647701234567");
  });

  it("leaves an already-E.164 Iraqi number unchanged", () => {
    expect(normalizePhone("+9647701234567")).toBe("+9647701234567");
  });

  it("preserves a non-Iraqi international number as-is (no Iraqi prefix guessing)", () => {
    expect(normalizePhone("+970567124698")).toBe("+970567124698");
  });

  it("strips spaces/dashes/parens before normalizing", () => {
    expect(normalizePhone("077 012-3456 (7)")).toBe("+9647701234567");
  });

  it("treats a 00-prefixed number as international", () => {
    expect(normalizePhone("00970567124698")).toBe("+970567124698");
  });

  // Corrected contract: normalizePhone used to fall through to a bare "+964"
  // for empty/junk input (a latent bug — an SMS could be sent to "+964" with
  // no actual number). It now returns null whenever there are no real digits
  // left after stripping, so callers can explicitly skip the send.
  it("returns null for empty input", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null for non-numeric junk", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
  });

  it("returns null for a bare leading zero with nothing after it", () => {
    expect(normalizePhone("0")).toBeNull();
  });
});

describe("phoneSearchSuffix", () => {
  it("derives the same suffix from +964, local-zero, and bare national forms", () => {
    const suffix = phoneSearchSuffix("+9647701234567");
    expect(suffix).toBe("7701234567");
    expect(phoneSearchSuffix("07701234567")).toBe(suffix);
    expect(phoneSearchSuffix("7701234567")).toBe(suffix);
  });

  it("derives the same suffix from an 00964-prefixed form", () => {
    expect(phoneSearchSuffix("00964 770 123 4567")).toBe("7701234567");
  });

  it("strips spaces/dashes/parens before deriving the suffix", () => {
    expect(phoneSearchSuffix("077 012-3456 (7)")).toBe("7701234567");
  });

  it("accepts a short trailing-digits partial search (min 4 digits)", () => {
    expect(phoneSearchSuffix("4567")).toBe("4567");
  });

  it("returns null when fewer than 4 usable digits remain", () => {
    expect(phoneSearchSuffix("456")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(phoneSearchSuffix("")).toBeNull();
  });

  it("returns null for non-numeric junk", () => {
    expect(phoneSearchSuffix("not-a-phone")).toBeNull();
  });

  it("caps the suffix at 10 digits for longer international numbers", () => {
    expect(phoneSearchSuffix("+123456789012345")).toBe("6789012345");
  });
});
