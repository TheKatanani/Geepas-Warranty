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
  discountApplicationStrategy: "FIRST",
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

  const physicalLinesByProductId = new Map<string, any>();
  for (const line of lines) {
    const product = line.merchandise?.product;
    if (product?.id) {
      physicalLinesByProductId.set(product.id, line);
      const numericId = product.id.replace("gid://shopify/Product/", "");
      physicalLinesByProductId.set(numericId, line);
    }
  }

  const discounts: any[] = [];

  for (const line of lines) {
    const product = line.merchandise?.product;
    if (!product) continue;

    const isWarrantyLine =
      product.hasWarrantyServiceTag === true ||
      product.productType === "Warranty Service" ||
      Boolean(line.attribute?.value) ||
      (product.title && product.title.toLowerCase().includes("warranty"));

    if (!isWarrantyLine) {
      continue;
    }

    const protectsProductId = line.attribute?.value?.trim();
    let targetPhysicalLine: any = null;

    if (protectsProductId) {
      targetPhysicalLine = physicalLinesByProductId.get(protectsProductId);
    }

    // Fallback: match any other physical product line in cart
    if (!targetPhysicalLine) {
      for (const otherLine of lines) {
        if (otherLine.id !== line.id) {
          const otherProd = otherLine.merchandise?.product;
          if (otherProd && !otherProd.title?.toLowerCase().includes("warranty")) {
            targetPhysicalLine = otherLine;
            break;
          }
        }
      }
    }

    if (!targetPhysicalLine) {
      continue;
    }

    const basePriceAmount = parseFloat(targetPhysicalLine.cost?.amountPerQuantity?.amount || "0");
    if (basePriceAmount <= 0) {
      continue;
    }

    // Default 15% warranty fee
    let multiplier = 0.15;
    if (product.priceMultiplierMetafield?.value) {
      const parsed = parseFloat(product.priceMultiplierMetafield.value);
      if (!isNaN(parsed) && parsed > 0) {
        multiplier = parsed >= 1.0 && parsed < 2.0 ? parsed - 1.0 : parsed;
      }
    }

    // Calculate desired 15% warranty price
    const desiredWarrantyPrice = Math.round(basePriceAmount * multiplier);
    const currentWarrantyUnitPrice = parseFloat(line.cost?.amountPerQuantity?.amount || "0");

    // Discount reduces the catalog base price down to the 15% desired price
    const discountPerItem = Math.max(0, currentWarrantyUnitPrice - desiredWarrantyPrice);

    if (discountPerItem > 0) {
      discounts.push({
        targets: [
          {
            cartLine: {
              id: line.id,
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
      discountApplicationStrategy: "FIRST",
    })
  );
}

run();
