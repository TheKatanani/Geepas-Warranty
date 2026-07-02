import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone.server";

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
