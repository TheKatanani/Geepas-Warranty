async function main() {
  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
  };

  // Test Coffee machine
  const res1 = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers,
    body: JSON.stringify({ items: [{ id: 54402859106595, quantity: 1 }] }),
  });
  console.log("Coffee machine via items array:", res1.status, await res1.text());

  // Test Warranty product
  const res2 = await fetch("https://ae53cd-2.myshopify.com/cart/add.js", {
    method: "POST",
    headers,
    body: JSON.stringify({ items: [{ id: 55477194653987, quantity: 1 }] }),
  });
  console.log("Warranty variant via items array:", res2.status, await res2.text());
}

main().catch(console.error);
