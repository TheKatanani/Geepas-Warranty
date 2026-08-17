async function main() {
  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
  };

  // Test adding warranty variant directly:
  console.log("Testing POST warranty variant 55477194653987...");
  const res = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers,
    body: JSON.stringify({
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
    }),
  });
  console.log("Cart Add Status:", res.status);
  const text = await res.text();
  console.log("Response Body:", text.slice(0, 500));
}

main().catch(console.error);
