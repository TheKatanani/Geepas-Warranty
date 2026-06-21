import type { MetaFunction } from "@remix-run/node";
import { useState, useCallback, useEffect, useRef } from "react";

export const meta: MetaFunction = () => {
  return [
    { title: "Geepas Warranty Registration" },
    { name: "description", content: "Register your Geepas product warranty" },
  ];
};

// ---- Iraqi Cities ----
const IRAQI_CITIES = [
  "Baghdad",
  "Basra",
  "Erbil",
  "Sulaymaniyah",
  "Mosul",
  "Kirkuk",
  "Najaf",
  "Karbala",
  "Nasiriyah",
  "Amarah",
  "Diwaniyah",
  "Kut",
  "Hillah",
  "Samawah",
  "Ramadi",
  "Fallujah",
  "Tikrit",
  "Baqubah",
  "Duhok",
  "Halabja",
  "Zakho",
];

// ---- Types ----
type Step = "phone" | "details" | "products" | "review" | "success";

interface CustomerData {
  exists: boolean;
  lookupFailed?: boolean;
  customerId?: string;
  firstName?: string;
  email?: string;
}

interface ProductEntry {
  id: string; // local unique key
  productId: string | null; // Shopify GID or null
  productTitle: string;
  sku: string | null;
  isManual: boolean;
}

interface ShopifyProduct {
  id: string;
  title: string;
  sku: string | null;
}

interface FormErrors {
  [key: string]: string;
}

// ---- Component ----
export default function WarrantyRegister() {
  // Get shop from URL params
  const [shop, setShop] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShop(params.get("shop") || "");
  }, []);

  // Step management
  const [currentStep, setCurrentStep] = useState<Step>("phone");
  const [errors, setErrors] = useState<FormErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1: Phone lookup
  const [phone, setPhone] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  // Step 2: Customer details
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [storeName, setStoreName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");

  // Step 3: Products
  const [products, setProducts] = useState<ProductEntry[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ShopifyProduct[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Success data
  const [successData, setSuccessData] = useState<any>(null);

  // ---- Phone Lookup ----
  const handlePhoneLookup = useCallback(async () => {
    if (!phone || phone.trim().length < 7) {
      setErrors({ phone: "Please enter a valid phone number." });
      return;
    }
    if (!shop) {
      setGlobalError("Shop parameter is missing from the URL.");
      return;
    }

    setIsLookingUp(true);
    setGlobalError("");
    setErrors({});

    try {
      const res = await fetch(
        `/api/customer-lookup?phone=${encodeURIComponent(phone)}&shop=${encodeURIComponent(shop)}`
      );
      
      if (!res.ok) {
        console.warn("Lookup response not OK, transitioning to details step as a new customer.");
        setCustomerData({ exists: false, lookupFailed: true });
        setIsNewCustomer(true);
        setFirstName("");
        setEmail("");
        setCurrentStep("details");
        return;
      }

      const data = await res.json();
      setCustomerData(data);

      if (data.exists) {
        setIsNewCustomer(false);
        setFirstName(data.firstName || "");
        setEmail(data.email || "");
      } else {
        setIsNewCustomer(true);
        setFirstName("");
        setEmail("");
      }

      setCurrentStep("details");
    } catch (err) {
      console.warn("Lookup request failed with network error, transitioning to details step.", err);
      setCustomerData({ exists: false, lookupFailed: true });
      setIsNewCustomer(true);
      setFirstName("");
      setEmail("");
      setCurrentStep("details");
    } finally {
      setIsLookingUp(false);
    }
  }, [phone, shop]);

  // ---- Product Search ----
  const handleProductSearch = useCallback(
    (query: string) => {
      setProductSearch(query);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (query.length < 2) {
        setSearchResults([]);
        return;
      }

      searchTimeoutRef.current = setTimeout(async () => {
        setIsSearching(true);
        try {
          const res = await fetch(
            `/api/products?shop=${encodeURIComponent(shop)}&search=${encodeURIComponent(query)}`
          );
          const data = await res.json();
          setSearchResults(data.products || []);
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      }, 400);
    },
    [shop]
  );

  const addProduct = useCallback((product: ShopifyProduct) => {
    setProducts((prev) => {
      // Avoid duplicates
      if (prev.some((p) => p.productId === product.id)) return prev;
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          productId: product.id,
          productTitle: product.title,
          sku: product.sku,
          isManual: false,
        },
      ];
    });
    setProductSearch("");
    setSearchResults([]);
  }, []);

  const addManualProduct = useCallback(() => {
    if (!manualTitle.trim()) return;
    setProducts((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        productId: null,
        productTitle: manualTitle.trim(),
        sku: null,
        isManual: true,
      },
    ]);
    setManualTitle("");
    setShowManualEntry(false);
  }, [manualTitle]);

  const removeProduct = useCallback((id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ---- Step Validation ----
  const validateDetails = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    if (!firstName.trim() || firstName.trim().length < 2)
      newErrors.firstName = "First name is required.";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      newErrors.email = "Valid email is required.";
    if (!city) newErrors.city = "City is required.";
    if (!storeName.trim()) newErrors.store = "Store name is required.";
    if (!purchaseDate) newErrors.purchaseDate = "Purchase date is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [firstName, email, city, storeName, purchaseDate]);

  const validateProducts = useCallback((): boolean => {
    if (products.length === 0) {
      setErrors({ products: "Add at least one product." });
      return false;
    }
    setErrors({});
    return true;
  }, [products]);

  // ---- Submit ----
  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setGlobalError("");

    try {
      const payload = {
        shop,
        firstName: firstName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        city,
        store: storeName.trim(),
        purchaseDate,
        invoiceNumber: invoiceNumber.trim() || null,
        isNewCustomer,
        products: products.map((p) => ({
          productId: p.productId,
          productTitle: p.productTitle,
          sku: p.sku,
          isManual: p.isManual,
        })),
      };

      const res = await fetch("/api/warranty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.errors) {
          setGlobalError(result.errors.join(", "));
        } else {
          setGlobalError(result.error || "Something went wrong.");
        }
        setIsSubmitting(false);
        return;
      }

      setSuccessData(result);
      setCurrentStep("success");
    } catch {
      setGlobalError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    shop,
    firstName,
    email,
    phone,
    city,
    storeName,
    purchaseDate,
    invoiceNumber,
    isNewCustomer,
    products,
  ]);

  // ---- Reset ----
  const handleReset = useCallback(() => {
    setCurrentStep("phone");
    setPhone("");
    setCustomerData(null);
    setIsNewCustomer(false);
    setFirstName("");
    setEmail("");
    setCity("");
    setStoreName("");
    setPurchaseDate("");
    setInvoiceNumber("");
    setProducts([]);
    setSuccessData(null);
    setErrors({});
    setGlobalError("");
  }, []);

  // ---- Progress Bar ----
  const steps: Step[] = ["phone", "details", "products", "review"];
  const stepLabels = ["Phone", "Details", "Products", "Review"];
  const currentIndex = steps.indexOf(currentStep);

  // ---- Render ----
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Warranty Registration</h1>
          <p style={styles.subtitle}>
            Register your Geepas product to activate your warranty coverage
          </p>
        </div>

        {/* Progress Bar */}
        {currentStep !== "success" && (
          <div style={styles.progressContainer}>
            {steps.map((step, i) => (
              <div key={step} style={styles.progressStep}>
                <div
                  style={{
                    ...styles.progressDot,
                    ...(i <= currentIndex
                      ? styles.progressDotActive
                      : {}),
                  }}
                >
                  {i < currentIndex ? "✓" : i + 1}
                </div>
                <span
                  style={{
                    ...styles.progressLabel,
                    ...(i <= currentIndex
                      ? styles.progressLabelActive
                      : {}),
                  }}
                >
                  {stepLabels[i]}
                </span>
                {i < steps.length - 1 && (
                  <div
                    style={{
                      ...styles.progressLine,
                      ...(i < currentIndex
                        ? styles.progressLineActive
                        : {}),
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {globalError && <div style={styles.globalError}>{globalError}</div>}

        {/* ---- STEP: Phone Lookup ---- */}
        {currentStep === "phone" && (
          <div style={styles.stepContent}>
            <h2 style={styles.stepTitle}>Enter your mobile number</h2>
            <p style={styles.stepDesc}>
              We'll check if you already have an account with us.
            </p>
            <div style={styles.field}>
              <label htmlFor="reg-phone" style={styles.label}>
                Mobile Number <span style={styles.required}>*</span>
              </label>
              <input
                id="reg-phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrors((prev) => {
                    const n = { ...prev };
                    delete n.phone;
                    return n;
                  });
                }}
                placeholder="07XX XXX XXXX"
                style={{
                  ...styles.input,
                  ...(errors.phone ? styles.inputError : {}),
                }}
              />
              {errors.phone && <p style={styles.error}>{errors.phone}</p>}
            </div>
            <button
              style={{
                ...styles.button,
                ...(isLookingUp ? styles.buttonDisabled : {}),
              }}
              disabled={isLookingUp}
              onClick={handlePhoneLookup}
            >
              {isLookingUp ? "Looking up..." : "Continue"}
            </button>
          </div>
        )}

        {/* ---- STEP: Customer Details ---- */}
        {currentStep === "details" && (
          <div style={styles.stepContent}>
            {/* Customer status banner */}
            {customerData?.exists ? (
              <div style={styles.successBanner}>
                <span style={styles.bannerIcon}>✓</span>
                Welcome back! We found your account.
              </div>
            ) : customerData?.lookupFailed ? (
              <div style={styles.infoBanner}>
                <span style={styles.bannerIcon}>ℹ</span>
                We couldn't verify your account at the moment. You can continue and we'll create or update your account during registration.
              </div>
            ) : (
              <div style={styles.infoBanner}>
                <span style={styles.bannerIcon}>ℹ</span>
                No existing account found. A new account will be created automatically when you submit your warranty registration.
              </div>
            )}

            <div style={styles.form}>
              {/* Name */}
              <div style={styles.field}>
                <label htmlFor="reg-firstName" style={styles.label}>
                  First Name <span style={styles.required}>*</span>
                </label>
                <input
                  id="reg-firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Your first name"
                  readOnly={customerData?.exists && !!firstName}
                  style={{
                    ...styles.input,
                    ...(errors.firstName ? styles.inputError : {}),
                    ...(customerData?.exists && firstName
                      ? styles.inputReadOnly
                      : {}),
                  }}
                />
                {errors.firstName && (
                  <p style={styles.error}>{errors.firstName}</p>
                )}
              </div>

              {/* Email */}
              <div style={styles.field}>
                <label htmlFor="reg-email" style={styles.label}>
                  Email Address <span style={styles.required}>*</span>
                </label>
                <input
                  id="reg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  readOnly={customerData?.exists && !!email}
                  style={{
                    ...styles.input,
                    ...(errors.email ? styles.inputError : {}),
                    ...(customerData?.exists && email
                      ? styles.inputReadOnly
                      : {}),
                  }}
                />
                {errors.email && <p style={styles.error}>{errors.email}</p>}
              </div>

              {/* City */}
              <div style={styles.field}>
                <label htmlFor="reg-city" style={styles.label}>
                  City <span style={styles.required}>*</span>
                </label>
                <select
                  id="reg-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{
                    ...styles.input,
                    ...styles.select,
                    ...(errors.city ? styles.inputError : {}),
                  }}
                >
                  <option value="">Select your city</option>
                  {IRAQI_CITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {errors.city && <p style={styles.error}>{errors.city}</p>}
              </div>

              {/* Store */}
              <div style={styles.field}>
                <label htmlFor="reg-store" style={styles.label}>
                  Store <span style={styles.required}>*</span>
                </label>
                <input
                  id="reg-store"
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Store where you purchased"
                  style={{
                    ...styles.input,
                    ...(errors.store ? styles.inputError : {}),
                  }}
                />
                {errors.store && <p style={styles.error}>{errors.store}</p>}
              </div>

              {/* Purchase Date */}
              <div style={styles.field}>
                <label htmlFor="reg-purchaseDate" style={styles.label}>
                  Purchase Date <span style={styles.required}>*</span>
                </label>
                <input
                  id="reg-purchaseDate"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  style={{
                    ...styles.input,
                    ...(errors.purchaseDate ? styles.inputError : {}),
                  }}
                />
                {errors.purchaseDate && (
                  <p style={styles.error}>{errors.purchaseDate}</p>
                )}
              </div>

              {/* Invoice Number (optional) */}
              <div style={styles.field}>
                <label htmlFor="reg-invoice" style={styles.label}>
                  Invoice Number
                </label>
                <input
                  id="reg-invoice"
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Optional"
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.buttonRow}>
              <button
                style={styles.buttonSecondary}
                onClick={() => setCurrentStep("phone")}
              >
                ← Back
              </button>
              <button
                style={styles.button}
                onClick={() => {
                  if (validateDetails()) setCurrentStep("products");
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP: Products ---- */}
        {currentStep === "products" && (
          <div style={styles.stepContent}>
            <h2 style={styles.stepTitle}>Add your products</h2>
            <p style={styles.stepDesc}>
              Search from our catalog or add a product manually.
            </p>

            {/* Product Search */}
            <div style={styles.field}>
              <label htmlFor="product-search" style={styles.label}>
                Search Products
              </label>
              <input
                id="product-search"
                type="text"
                value={productSearch}
                onChange={(e) => handleProductSearch(e.target.value)}
                placeholder="Type to search (e.g. Air Fryer)"
                style={styles.input}
              />
              {isSearching && (
                <p style={styles.searchingText}>Searching...</p>
              )}
              {searchResults.length > 0 && (
                <div style={styles.searchDropdown}>
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      style={styles.searchItem}
                      onClick={() => addProduct(p)}
                    >
                      <span style={styles.searchItemTitle}>{p.title}</span>
                      {p.sku && (
                        <span style={styles.searchItemSku}>
                          SKU: {p.sku}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Manual Entry Toggle */}
            <button
              style={styles.linkButton}
              onClick={() => setShowManualEntry(!showManualEntry)}
            >
              {showManualEntry
                ? "Cancel manual entry"
                : "Can't find your product? Enter manually"}
            </button>

            {showManualEntry && (
              <div style={styles.manualEntryRow}>
                <input
                  id="manual-product-title"
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="Product name (e.g. Geepas Air Fryer 5L)"
                  style={{ ...styles.input, flex: 1 }}
                />
                <button
                  style={styles.addButton}
                  onClick={addManualProduct}
                  disabled={!manualTitle.trim()}
                >
                  + Add
                </button>
              </div>
            )}

            {/* Product List */}
            {products.length > 0 && (
              <div style={styles.productList}>
                <h3 style={styles.productListTitle}>
                  Selected Products ({products.length})
                </h3>
                {products.map((p) => (
                  <div key={p.id} style={styles.productItem}>
                    <div style={styles.productInfo}>
                      <span style={styles.productName}>{p.productTitle}</span>
                      <span style={styles.productMeta}>
                        {p.isManual ? "Manual entry" : "Catalog product"}
                        {p.sku ? ` · SKU: ${p.sku}` : ""}
                      </span>
                    </div>
                    <button
                      style={styles.removeButton}
                      onClick={() => removeProduct(p.id)}
                      aria-label="Remove product"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {errors.products && (
              <p style={styles.error}>{errors.products}</p>
            )}

            <div style={styles.buttonRow}>
              <button
                style={styles.buttonSecondary}
                onClick={() => setCurrentStep("details")}
              >
                ← Back
              </button>
              <button
                style={styles.button}
                onClick={() => {
                  if (validateProducts()) setCurrentStep("review");
                }}
              >
                Review Registration
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP: Review ---- */}
        {currentStep === "review" && (
          <div style={styles.stepContent}>
            <h2 style={styles.stepTitle}>Review your registration</h2>
            <p style={styles.stepDesc}>
              Please verify the information below before submitting.
            </p>

            <div style={styles.reviewSection}>
              <h3 style={styles.reviewLabel}>Customer</h3>
              <div style={styles.reviewGrid}>
                <div>
                  <span style={styles.reviewFieldLabel}>Name</span>
                  <span style={styles.reviewFieldValue}>{firstName}</span>
                </div>
                <div>
                  <span style={styles.reviewFieldLabel}>Email</span>
                  <span style={styles.reviewFieldValue}>{email}</span>
                </div>
                <div>
                  <span style={styles.reviewFieldLabel}>Phone</span>
                  <span style={styles.reviewFieldValue}>{phone}</span>
                </div>
                <div>
                  <span style={styles.reviewFieldLabel}>Type</span>
                  <span style={styles.reviewFieldValue}>
                    {isNewCustomer ? "New Customer" : "Returning Customer"}
                  </span>
                </div>
              </div>
            </div>

            <div style={styles.reviewDivider} />

            <div style={styles.reviewSection}>
              <h3 style={styles.reviewLabel}>Purchase Details</h3>
              <div style={styles.reviewGrid}>
                <div>
                  <span style={styles.reviewFieldLabel}>City</span>
                  <span style={styles.reviewFieldValue}>{city}</span>
                </div>
                <div>
                  <span style={styles.reviewFieldLabel}>Store</span>
                  <span style={styles.reviewFieldValue}>{storeName}</span>
                </div>
                <div>
                  <span style={styles.reviewFieldLabel}>Purchase Date</span>
                  <span style={styles.reviewFieldValue}>
                    {new Date(purchaseDate).toLocaleDateString()}
                  </span>
                </div>
                {invoiceNumber && (
                  <div>
                    <span style={styles.reviewFieldLabel}>Invoice #</span>
                    <span style={styles.reviewFieldValue}>
                      {invoiceNumber}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div style={styles.reviewDivider} />

            <div style={styles.reviewSection}>
              <h3 style={styles.reviewLabel}>
                Products ({products.length})
              </h3>
              {products.map((p) => (
                <div key={p.id} style={styles.reviewProductItem}>
                  <span>{p.productTitle}</span>
                  <span style={styles.reviewProductMeta}>
                    {p.isManual ? "Manual" : "Catalog"}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </span>
                </div>
              ))}
            </div>

            <div style={styles.buttonRow}>
              <button
                style={styles.buttonSecondary}
                onClick={() => setCurrentStep("products")}
              >
                ← Back
              </button>
              <button
                style={{
                  ...styles.button,
                  ...styles.buttonSubmit,
                  ...(isSubmitting ? styles.buttonDisabled : {}),
                }}
                disabled={isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting ? "Submitting..." : "Submit Registration"}
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP: Success ---- */}
        {currentStep === "success" && (
          <div style={styles.stepContent}>
            <div style={styles.successIcon}>✓</div>
            <h1 style={styles.successTitle}>Registration Complete!</h1>
            <p style={styles.successMessage}>
              Your warranty has been successfully registered.
              {successData?.smsSent
                ? " A confirmation SMS has been sent to your phone."
                : " You will receive a confirmation shortly."}
            </p>
            {successData?.reward?.discountCode && (
              <div style={styles.rewardBanner}>
                <span style={styles.rewardEmoji}>🎁</span>
                <div>
                  <p style={styles.rewardTitle}>
                    You earned a 15% discount!
                  </p>
                  <p style={styles.rewardCode}>
                    {successData.reward.discountCode}
                  </p>
                  <p style={styles.rewardDesc}>
                    Use this code on your next Geepas purchase.
                  </p>
                </div>
              </div>
            )}
            {successData?.reward?.message && (
              <div style={styles.infoBanner}>
                <span style={styles.bannerIcon}>ℹ</span>
                {successData.reward.message}
              </div>
            )}
            <button style={styles.button} onClick={handleReset}>
              Register Another Product
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Inline styles ----------
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    padding: "24px",
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "600px",
    background: "#ffffff",
    borderRadius: "16px",
    padding: "40px",
    boxShadow:
      "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.03)",
  },
  header: {
    marginBottom: "24px",
    textAlign: "center" as const,
  },
  title: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 8px 0",
  },
  subtitle: {
    fontSize: "15px",
    color: "#64748b",
    margin: 0,
  },
  // Progress
  progressContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "32px",
    gap: "0px",
  },
  progressStep: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  progressDot: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "#e2e8f0",
    color: "#94a3b8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 600,
    transition: "all 0.3s ease",
    flexShrink: 0,
  },
  progressDotActive: {
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#ffffff",
  },
  progressLabel: {
    fontSize: "12px",
    color: "#94a3b8",
    fontWeight: 500,
    whiteSpace: "nowrap" as const,
  },
  progressLabelActive: {
    color: "#2563eb",
    fontWeight: 600,
  },
  progressLine: {
    width: "40px",
    height: "2px",
    background: "#e2e8f0",
    margin: "0 4px",
    transition: "background 0.3s ease",
  },
  progressLineActive: {
    background: "#3b82f6",
  },
  // Steps
  stepContent: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "20px",
  },
  stepTitle: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
  },
  stepDesc: {
    fontSize: "14px",
    color: "#64748b",
    margin: 0,
  },
  // Form elements
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "18px",
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  label: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#334155",
  },
  required: {
    color: "#ef4444",
  },
  input: {
    padding: "12px 14px",
    fontSize: "15px",
    border: "1.5px solid #e2e8f0",
    borderRadius: "10px",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
    color: "#0f172a",
    background: "#f8fafc",
  },
  inputReadOnly: {
    background: "#f1f5f9",
    color: "#64748b",
    cursor: "default",
  },
  select: {
    appearance: "none" as const,
    cursor: "pointer",
    backgroundImage:
      'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")',
    backgroundPosition: "right 12px center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "16px",
    paddingRight: "36px",
  },
  inputError: {
    borderColor: "#ef4444",
    boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.1)",
  },
  error: {
    fontSize: "13px",
    color: "#ef4444",
    margin: 0,
  },
  globalError: {
    padding: "12px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "10px",
    color: "#dc2626",
    fontSize: "14px",
    marginBottom: "8px",
  },
  // Banners
  successBanner: {
    padding: "14px 16px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: "10px",
    color: "#166534",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontWeight: 500,
  },
  infoBanner: {
    padding: "14px 16px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: "10px",
    color: "#1e40af",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontWeight: 500,
  },
  bannerIcon: {
    fontSize: "18px",
    flexShrink: 0,
  },
  // Buttons
  button: {
    padding: "14px",
    fontSize: "16px",
    fontWeight: 600,
    color: "#ffffff",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "opacity 0.2s, transform 0.1s",
  },
  buttonSecondary: {
    padding: "14px 20px",
    fontSize: "15px",
    fontWeight: 500,
    color: "#64748b",
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "background 0.2s",
  },
  buttonSubmit: {
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  buttonRow: {
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginTop: "8px",
  },
  linkButton: {
    background: "none",
    border: "none",
    color: "#3b82f6",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
    padding: "4px 0",
    textAlign: "left" as const,
    textDecoration: "underline",
  },
  addButton: {
    padding: "12px 20px",
    fontSize: "14px",
    fontWeight: 600,
    color: "#ffffff",
    background: "#3b82f6",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  // Product search
  searchingText: {
    fontSize: "13px",
    color: "#94a3b8",
    margin: 0,
  },
  searchDropdown: {
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    maxHeight: "200px",
    overflowY: "auto" as const,
    background: "#ffffff",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
  },
  searchItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 14px",
    border: "none",
    borderBottom: "1px solid #f1f5f9",
    background: "transparent",
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
    transition: "background 0.15s",
    fontSize: "14px",
    color: "#0f172a",
  },
  searchItemTitle: {
    fontWeight: 500,
  },
  searchItemSku: {
    fontSize: "12px",
    color: "#94a3b8",
  },
  manualEntryRow: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },
  // Product list
  productList: {
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "16px",
    background: "#fafbfc",
  },
  productListTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#334155",
    margin: "0 0 12px 0",
  },
  productItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    marginBottom: "8px",
  },
  productInfo: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  },
  productName: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#0f172a",
  },
  productMeta: {
    fontSize: "12px",
    color: "#94a3b8",
  },
  removeButton: {
    background: "none",
    border: "none",
    color: "#ef4444",
    cursor: "pointer",
    fontSize: "16px",
    padding: "4px 8px",
    borderRadius: "6px",
    transition: "background 0.15s",
  },
  // Review
  reviewSection: {
    marginBottom: "4px",
  },
  reviewLabel: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#3b82f6",
    margin: "0 0 10px 0",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  reviewGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  reviewFieldLabel: {
    display: "block",
    fontSize: "12px",
    color: "#94a3b8",
    fontWeight: 500,
    marginBottom: "2px",
  },
  reviewFieldValue: {
    display: "block",
    fontSize: "14px",
    color: "#0f172a",
    fontWeight: 500,
  },
  reviewDivider: {
    height: "1px",
    background: "#e2e8f0",
    margin: "4px 0",
  },
  reviewProductItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    background: "#f8fafc",
    borderRadius: "8px",
    marginBottom: "6px",
    fontSize: "14px",
    color: "#0f172a",
  },
  reviewProductMeta: {
    fontSize: "12px",
    color: "#94a3b8",
  },
  // Success
  successIcon: {
    width: "64px",
    height: "64px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    color: "#fff",
    fontSize: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 20px",
  },
  successTitle: {
    fontSize: "24px",
    fontWeight: 700,
    color: "#0f172a",
    textAlign: "center" as const,
    margin: "0 0 12px 0",
  },
  successMessage: {
    fontSize: "15px",
    color: "#64748b",
    textAlign: "center" as const,
    margin: "0 0 24px 0",
    lineHeight: 1.6,
  },
  // Reward banner
  rewardBanner: {
    padding: "20px",
    background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
    border: "1px solid #fbbf24",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    gap: "16px",
    marginBottom: "8px",
  },
  rewardEmoji: {
    fontSize: "36px",
    flexShrink: 0,
  },
  rewardTitle: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#92400e",
    margin: "0 0 4px 0",
  },
  rewardCode: {
    fontSize: "22px",
    fontWeight: 800,
    color: "#78350f",
    margin: "0 0 4px 0",
    letterSpacing: "2px",
    fontFamily: "monospace",
  },
  rewardDesc: {
    fontSize: "13px",
    color: "#92400e",
    margin: 0,
  },
};
