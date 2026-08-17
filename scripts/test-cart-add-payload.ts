async function main() {
  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
  };

  // Test adding warranty variant directly:
  console.log("Adding warranty variant 55477194653987...");
  const res = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: 55477194653987,
      quantity: 1
    }),
  });
  console.log("Warranty direct add status:", res.status, await res.text());

  // Test multi-items payload:
  console.log("\nAdding multi-items...");
  const resMulti = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
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
  console.log("Multi-item add status:", resMulti.status, await resMulti.text());
}

main().catch(console.error);
