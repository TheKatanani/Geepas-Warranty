declare const Javy: {
  IO: {
    readSync: (fd: number, buffer: Uint8Array) => number;
    writeSync: (fd: number, buffer: Uint8Array) => number;
  };
};

function readInput(): string {
  const chunkSize = 1024;
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const buffer = new Uint8Array(chunkSize);
    const bytesRead = Javy.IO.readSync(0, buffer);
    if (bytesRead <= 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    totalLength += bytesRead;
    if (bytesRead < chunkSize) break;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

function writeOutput(data: string) {
  const encoded = new TextEncoder().encode(data);
  Javy.IO.writeSync(1, encoded);
}

const EMPTY_DISCOUNT = JSON.stringify({
  discounts: [],
  discountApplicationStrategy: "ALL",
});

function run() {
  const rawInput = readInput();
  if (!rawInput || !rawInput.trim()) {
    writeOutput(EMPTY_DISCOUNT);
    return;
  }

  let input: any;
  try {
    input = JSON.parse(rawInput);
  } catch (e) {
    writeOutput(EMPTY_DISCOUNT);
    return;
  }

  const lines = input?.cart?.lines || [];
  if (lines.length === 0) {
    writeOutput(EMPTY_DISCOUNT);
    return;
  }

  const physicalLinesByBundleId = new Map<string, any>();
  const physicalLinesByProductId = new Map<string, any>();
  const physicalLines: any[] = [];
  const warrantyLines: any[] = [];

  for (const line of lines) {
    const product = line.merchandise?.product;
    if (!product) continue;

    const isWarrantyLine =
      product.hasWarrantyServiceTag === true ||
      product.productType === "Warranty Service" ||
      (product.title && product.title.toLowerCase().includes("warranty")) ||
      Boolean(line.attribute?.value);

    if (isWarrantyLine) {
      warrantyLines.push(line);
    } else {
      physicalLines.push(line);
      const bundleId = line.bundleAttribute?.value?.trim();
      if (bundleId) {
        physicalLinesByBundleId.set(bundleId, line);
      }
      if (product.id) {
        physicalLinesByProductId.set(product.id, line);
        const numericId = product.id.replace("gid://shopify/Product/", "");
        physicalLinesByProductId.set(numericId, line);
      }
    }
  }

  if (warrantyLines.length === 0 || physicalLines.length === 0) {
    writeOutput(EMPTY_DISCOUNT);
    return;
  }

  const discounts: any[] = [];
  const claimedPhysicalLineIds = new Set<string>();

  for (const wLine of warrantyLines) {
    const wProduct = wLine.merchandise?.product;
    const bundleId = wLine.bundleAttribute?.value?.trim();
    const protectsProductId = wLine.attribute?.value?.trim();

    let targetPhysicalLine: any = null;

    // 1. Match by unique bundle ID
    if (bundleId && physicalLinesByBundleId.has(bundleId)) {
      targetPhysicalLine = physicalLinesByBundleId.get(bundleId);
    }

    // 2. Match by protected product ID
    if (!targetPhysicalLine && protectsProductId && physicalLinesByProductId.has(protectsProductId)) {
      targetPhysicalLine = physicalLinesByProductId.get(protectsProductId);
    }

    // 3. Fallback: match any unclaimed physical line in cart
    if (!targetPhysicalLine) {
      for (const pLine of physicalLines) {
        if (!claimedPhysicalLineIds.has(pLine.id)) {
          targetPhysicalLine = pLine;
          break;
        }
      }
    }

    if (!targetPhysicalLine) {
      continue;
    }

    claimedPhysicalLineIds.add(targetPhysicalLine.id);

    const basePriceAmount = parseFloat(targetPhysicalLine.cost?.amountPerQuantity?.amount || "0");
    if (basePriceAmount <= 0) {
      continue;
    }

    // Read multiplier (default 15%)
    let multiplier = 0.15;
    if (wProduct?.priceMultiplierMetafield?.value) {
      const parsed = parseFloat(wProduct.priceMultiplierMetafield.value);
      if (!isNaN(parsed) && parsed > 0) {
        multiplier = parsed >= 1.0 && parsed < 2.0 ? parsed - 1.0 : parsed;
      }
    }

    // Calculate desired warranty price: 15% of the physical product
    const desiredWarrantyPrice = Math.round(basePriceAmount * multiplier);
    const currentWarrantyUnitPrice = parseFloat(wLine.cost?.amountPerQuantity?.amount || "0");

    // Discount reduces catalog price (e.g. 500,000) down to desired warranty price
    const discountPerItem = Math.max(0, currentWarrantyUnitPrice - desiredWarrantyPrice);

    if (discountPerItem > 0) {
      discounts.push({
        targets: [
          {
            cartLine: {
              id: wLine.id,
            },
          },
        ],
        value: {
          fixedAmount: {
            amount: discountPerItem.toFixed(2),
            appliesToEachItem: true,
          },
        },
        message: "تمديد الضمان إلى 3 سنوات (+15%)",
      });
    }
  }

  writeOutput(
    JSON.stringify({
      discounts,
      discountApplicationStrategy: "ALL",
    })
  );
}

run();
