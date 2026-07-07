import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// The registration form has no jsdom/component-rendering test harness in
// this project (see vitest.config.ts — node environment, *.test.ts only).
// This is a source-level regression guard: it fails loudly if the SKU input
// ever loses its forced LTR direction, without requiring a new rendering
// harness just for this one assertion.
const source = readFileSync(
  fileURLToPath(new URL("../routes/public.warranty-register.tsx", import.meta.url)),
  "utf-8",
);

describe("SKU field directionality inside the Arabic RTL registration form", () => {
  it("forces the SKU search input itself to render left-to-right", () => {
    const inputMatch = source.match(/id="product-search"[\s\S]{0,400}?\/>/);
    expect(inputMatch).not.toBeNull();
    expect(inputMatch![0]).toMatch(/dir="ltr"/);
  });

  it("does not force the SKU field's label direction (label stays RTL-safe)", () => {
    const labelMatch = source.match(
      /<label htmlFor="product-search"[\s\S]{0,150}?<\/label>/,
    );
    expect(labelMatch).not.toBeNull();
    expect(labelMatch![0]).not.toMatch(/dir="ltr"/);
  });

  it("keeps the SKU value itself isolated LTR in the result dropdown", () => {
    expect(source).toMatch(/gw-drop-sku-main[\s\S]{0,200}?direction:\s*ltr/);
  });
});
