async function main() {
  const payload = {
    items: [
      {
        id: 54402859106595,
        quantity: 1
      },
      {
        id: 55477194653987,
        quantity: 1,
        properties: {
          _protects_product_id: "10018934554915"
        }
      }
    ]
  };

  // Test 1: POST to /cart/add.js
  console.log("Testing POST to https://ae53cd-2.myshopify.com/cart/add.js");
  const res1 = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });
  console.log("Status 1:", res1.status, await res1.text());

  // Test 2: POST warranty only
  console.log("\nTesting POST warranty only to https://ae53cd-2.myshopify.com/cart/add.js");
  const res2 = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      id: 55477194653987,
      quantity: 1
    }),
  });
  console.log("Status 2:", res2.status, await res2.text());

  // Test 3: POST coffee machine only
  console.log("\nTesting POST coffee machine only to https://ae53cd-2.myshopify.com/cart/add.js");
  const res3 = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      id: 54402859106595,
      quantity: 1
    }),
  });
  console.log("Status 3:", res3.status, await res3.text());
}

main().catch(console.error);
