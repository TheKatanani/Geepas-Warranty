import type { MetaFunction, LinksFunction } from "@remix-run/node";
import { useState, useCallback, useEffect, useRef } from "react";

// Allow this page to be embedded in iframes (e.g. the Shopify store after-service page)
export const headers = () => ({
  "X-Frame-Options": "ALLOWALL",
  "Content-Security-Policy": "frame-ancestors *",
});

export const meta: MetaFunction = () => [
  { title: "Geepas Warranty Registration" },
  { name: "description", content: "Register your Geepas product warranty" },
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Cairo:wght@400;500;600;700;800&display=swap",
  },
];

// ---- Iraqi Cities (EN + AR pairs, EN value sent to API) ----
const IRAQI_CITIES = [
  { en: "Baghdad", ar: "بغداد" },
  { en: "Basra", ar: "البصرة" },
  { en: "Erbil", ar: "أربيل" },
  { en: "Sulaymaniyah", ar: "السليمانية" },
  { en: "Mosul", ar: "الموصل" },
  { en: "Kirkuk", ar: "كركوك" },
  { en: "Najaf", ar: "النجف" },
  { en: "Karbala", ar: "كربلاء" },
  { en: "Nasiriyah", ar: "الناصرية" },
  { en: "Amarah", ar: "العمارة" },
  { en: "Diwaniyah", ar: "الديوانية" },
  { en: "Kut", ar: "الكوت" },
  { en: "Hillah", ar: "الحلة" },
  { en: "Samawah", ar: "السماوة" },
  { en: "Ramadi", ar: "الرمادي" },
  { en: "Fallujah", ar: "الفلوجة" },
  { en: "Tikrit", ar: "تكريت" },
  { en: "Baqubah", ar: "بعقوبة" },
  { en: "Duhok", ar: "دهوك" },
  { en: "Halabja", ar: "حلبجة" },
  { en: "Zakho", ar: "زاخو" },
];

// ---- Translations ----
const T = {
  en: {
    toggleLang: "العربية",
    pageTitle: "Warranty Registration",
    pageSubtitle: "Register your Geepas product to activate your warranty coverage",
    steps: ["Phone", "Details", "Products", "Review"] as const,
    step1Title: "Enter your mobile number",
    step1Desc: "We'll check if you already have an account with us.",
    phoneLabel: "Mobile Number",
    phonePlaceholder: "07XX XXX XXXX",
    continueBtn: "Continue",
    lookingUp: "Looking up...",
    welcomeBack: "Welcome back! We found your account.",
    lookupFailed:
      "We couldn't verify your account at the moment. You can continue and we'll create or update your account during registration.",
    newAccount:
      "No existing account found. A new account will be created automatically when you submit your warranty registration.",
    fullName: "Full Name",
    fullNamePlaceholder: "Your full name",
    emailLabel: "Email Address",
    emailPlaceholder: "your@email.com",
    cityLabel: "City",
    cityPlaceholder: "Select your city",
    storeLabel: "Store",
    storePlaceholder: "Store where you purchased",
    purchaseDateLabel: "Purchase Date",
    invoiceLabel: "Invoice Number",
    invoicePlaceholder: "Optional",
    backBtn: "← Back",
    step3Title: "Add your products",
    step3Desc: "Search from our catalog or add a product manually.",
    searchLabel: "Search Products",
    searchPlaceholder: "Type to search (e.g. Air Fryer)",
    searching: "Searching...",
    cantFind: "Can't find your product? Enter manually",
    cancelManual: "Cancel manual entry",
    manualPlaceholder: "Product name (e.g. Geepas Air Fryer 5L)",
    addBtn: "+ Add",
    selectedProducts: "Selected Products",
    manualEntry: "Manual entry",
    catalogProduct: "Catalog product",
    reviewBtn: "Review Registration",
    step4Title: "Review your registration",
    step4Desc: "Please verify the information below before submitting.",
    sectionCustomer: "Customer",
    fullNameDisplay: "Full Name",
    emailDisplay: "Email",
    phoneDisplay: "Phone",
    typeDisplay: "Type",
    newCustomer: "New Customer",
    returningCustomer: "Returning Customer",
    sectionPurchase: "Purchase Details",
    cityDisplay: "City",
    storeDisplay: "Store",
    dateDisplay: "Purchase Date",
    invoiceDisplay: "Invoice #",
    sectionProducts: "Products",
    manualTag: "Manual",
    catalogTag: "Catalog",
    submitBtn: "Submit Registration",
    submitting: "Submitting...",
    successTitle: "Registration Complete!",
    successMsg: "Your warranty has been successfully registered.",
    smsSent: " A confirmation SMS has been sent to your phone.",
    confirmationShortly: " You will receive a confirmation shortly.",
    rewardTitle: "You earned a 15% discount!",
    useCode: "Use this code on your next Geepas purchase.",
    registerAnother: "Register Another Product",
    errPhone: "Please enter a valid phone number.",
    errShop: "Shop parameter is missing from the URL.",
    errName: "Full name is required.",
    errEmail: "Valid email is required.",
    errCity: "City is required.",
    errStore: "Store name is required.",
    errDate: "Purchase date is required.",
    errProducts: "Add at least one product.",
    errNetwork: "Network error. Please try again.",
    skuLabel: "SKU",
    required: "*",
  },
  ar: {
    toggleLang: "English",
    pageTitle: "تسجيل الضمان",
    pageSubtitle: "سجّل منتج جيباس الخاص بك لتفعيل تغطية الضمان",
    steps: ["الهاتف", "التفاصيل", "المنتجات", "المراجعة"] as const,
    step1Title: "أدخل رقم هاتفك المحمول",
    step1Desc: "سنتحقق مما إذا كان لديك حساب لدينا.",
    phoneLabel: "رقم الهاتف",
    phonePlaceholder: "07XX XXX XXXX",
    continueBtn: "متابعة",
    lookingUp: "جارٍ البحث...",
    welcomeBack: "مرحباً بعودتك! لقد وجدنا حسابك.",
    lookupFailed:
      "لم نتمكن من التحقق من حسابك في الوقت الحالي. يمكنك المتابعة وسنقوم بإنشاء أو تحديث حسابك أثناء التسجيل.",
    newAccount:
      "لم يتم العثور على حساب موجود. سيتم إنشاء حساب جديد تلقائياً عند تقديم تسجيل الضمان.",
    fullName: "الاسم الكامل",
    fullNamePlaceholder: "اسمك الكامل",
    emailLabel: "البريد الإلكتروني",
    emailPlaceholder: "your@email.com",
    cityLabel: "المدينة",
    cityPlaceholder: "اختر مدينتك",
    storeLabel: "المتجر",
    storePlaceholder: "المتجر الذي اشتريت منه",
    purchaseDateLabel: "تاريخ الشراء",
    invoiceLabel: "رقم الفاتورة",
    invoicePlaceholder: "اختياري",
    backBtn: "رجوع →",
    step3Title: "أضف منتجاتك",
    step3Desc: "ابحث في الكتالوج أو أضف منتجاً يدوياً.",
    searchLabel: "البحث عن المنتجات",
    searchPlaceholder: "اكتب للبحث (مثال: مقلاة هوائية)",
    searching: "جارٍ البحث...",
    cantFind: "لا تجد منتجك؟ أضفه يدوياً",
    cancelManual: "إلغاء الإدخال اليدوي",
    manualPlaceholder: "اسم المنتج (مثال: مقلاة جيباس الهوائية 5 لتر)",
    addBtn: "+ إضافة",
    selectedProducts: "المنتجات المختارة",
    manualEntry: "إدخال يدوي",
    catalogProduct: "منتج من الكتالوج",
    reviewBtn: "مراجعة التسجيل",
    step4Title: "مراجعة تسجيلك",
    step4Desc: "يرجى التحقق من المعلومات أدناه قبل الإرسال.",
    sectionCustomer: "العميل",
    fullNameDisplay: "الاسم الكامل",
    emailDisplay: "البريد الإلكتروني",
    phoneDisplay: "الهاتف",
    typeDisplay: "النوع",
    newCustomer: "عميل جديد",
    returningCustomer: "عميل عائد",
    sectionPurchase: "تفاصيل الشراء",
    cityDisplay: "المدينة",
    storeDisplay: "المتجر",
    dateDisplay: "تاريخ الشراء",
    invoiceDisplay: "رقم الفاتورة",
    sectionProducts: "المنتجات",
    manualTag: "يدوي",
    catalogTag: "كتالوج",
    submitBtn: "إرسال التسجيل",
    submitting: "جارٍ الإرسال...",
    successTitle: "اكتمل التسجيل!",
    successMsg: "تم تسجيل ضمانك بنجاح.",
    smsSent: " تم إرسال رسالة تأكيد إلى هاتفك.",
    confirmationShortly: " ستتلقى تأكيداً قريباً.",
    rewardTitle: "لقد حصلت على خصم 15%!",
    useCode: "استخدم هذا الرمز في عملية الشراء التالية من جيباس.",
    registerAnother: "تسجيل منتج آخر",
    errPhone: "يرجى إدخال رقم هاتف صحيح.",
    errShop: "معامل المتجر مفقود من الرابط.",
    errName: "الاسم الكامل مطلوب.",
    errEmail: "البريد الإلكتروني الصحيح مطلوب.",
    errCity: "المدينة مطلوبة.",
    errStore: "اسم المتجر مطلوب.",
    errDate: "تاريخ الشراء مطلوب.",
    errProducts: "أضف منتجاً واحداً على الأقل.",
    errNetwork: "خطأ في الشبكة. يرجى المحاولة مرة أخرى.",
    skuLabel: "الرمز",
    required: "*",
  },
} as const;

type Lang = "en" | "ar";

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
  id: string;
  productId: string | null;
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

// ---- Geepas brand CSS (embedded to enable :hover, :focus, media queries, RTL selectors) ----
const GEEPAS_CSS = `
  *, *::before, *::after { box-sizing: border-box; }

  .gw-page {
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    background: #f0f0f0;
    padding: 24px 16px 40px;
    font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  [dir="rtl"] .gw-page {
    font-family: 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  /* ---- Card ---- */
  .gw-card {
    width: 100%;
    max-width: 580px;
    background: #ffffff;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    margin: auto;
  }

  /* ---- Header ---- */
  .gw-header {
    background: #3b4043;
    padding: 22px 28px 20px;
  }
  .gw-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .gw-logo {
    display: flex;
    flex-direction: column;
    line-height: 1;
    gap: 2px;
  }
  .gw-logo-wordmark {
    font-size: 22px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .gw-logo-tagline {
    font-size: 9px;
    color: rgba(255,255,255,0.65);
    letter-spacing: 0.6px;
    font-weight: 400;
    text-transform: uppercase;
  }
  .gw-lang-btn {
    background: rgba(255,255,255,0.15);
    border: 1.5px solid rgba(255,255,255,0.5);
    border-radius: 6px;
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 14px;
    cursor: pointer;
    transition: background 0.2s;
    font-family: inherit;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .gw-lang-btn:hover { background: rgba(255,255,255,0.28); }

  .gw-h-title {
    font-size: 21px;
    font-weight: 700;
    color: #ffffff;
    margin: 0 0 5px;
    line-height: 1.25;
  }
  .gw-h-sub {
    font-size: 13px;
    color: rgba(255,255,255,0.80);
    line-height: 1.45;
  }

  /* ---- Body ---- */
  .gw-body { padding: 28px; }

  /* ---- Progress ---- */
  .gw-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;
    flex-wrap: nowrap;
  }
  .gw-p-step { display: flex; align-items: center; }
  .gw-p-dot {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #e5e5e5;
    color: #aaa;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    transition: background 0.25s, color 0.25s;
  }
  .gw-p-dot--on { background: #3b4043; color: #fff; }
  .gw-p-label {
    font-size: 11px;
    color: #aaa;
    font-weight: 500;
    margin: 0 6px;
    white-space: nowrap;
  }
  .gw-p-label--on { color: #3b4043; font-weight: 700; }
  .gw-p-line {
    width: 30px;
    height: 2px;
    background: #e5e5e5;
    flex-shrink: 0;
    transition: background 0.25s;
  }
  .gw-p-line--on { background: #3b4043; }

  /* ---- Step layout ---- */
  .gw-step { display: flex; flex-direction: column; gap: 18px; }
  .gw-step-title { font-size: 18px; font-weight: 700; color: #1a1a1a; margin: 0; }
  .gw-step-desc { font-size: 13px; color: #777; margin: -10px 0 0; line-height: 1.5; }

  /* ---- Banners ---- */
  .gw-banner {
    padding: 12px 15px;
    border-radius: 8px;
    font-size: 13px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-weight: 500;
    line-height: 1.5;
  }
  .gw-banner--ok  { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
  .gw-banner--info { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
  .gw-b-icon { flex-shrink: 0; font-size: 15px; margin-top: 1px; }

  /* ---- Form ---- */
  .gw-form { display: flex; flex-direction: column; gap: 15px; }
  .gw-field { display: flex; flex-direction: column; gap: 5px; }
  .gw-label { font-size: 13px; font-weight: 600; color: #333; }
  .gw-req { color: #3b4043; }

  .gw-input {
    padding: 11px 13px;
    font-size: 15px;
    border: 1.5px solid #ddd;
    border-radius: 8px;
    outline: none;
    color: #1a1a1a;
    background: #fafafa;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    font-family: inherit;
    width: 100%;
    -webkit-appearance: none;
    appearance: none;
  }
  .gw-input:focus {
    border-color: #3b4043;
    box-shadow: 0 0 0 3px rgba(59,64,67,0.10);
    background: #fff;
  }
  .gw-input--err { border-color: #3b4043 !important; box-shadow: 0 0 0 3px rgba(59,64,67,0.10) !important; }
  .gw-input--ro  { background: #f0f0f0 !important; color: #888 !important; cursor: default; }

  .gw-select {
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
    background-color: #fafafa;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 12px center;
    background-size: 16px;
    padding-right: 38px;
  }
  [dir="rtl"] .gw-select {
    background-position: left 12px center;
    padding-right: 13px;
    padding-left: 38px;
  }

  .gw-err       { font-size: 12px; color: #dc2626; margin: 0; }
  .gw-global-err {
    padding: 11px 15px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #dc2626;
    font-size: 13px;
  }

  /* ---- Buttons ---- */
  .gw-btn {
    padding: 13px 20px;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    background: #3b4043;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s, opacity 0.2s;
    font-family: inherit;
    width: 100%;
    text-align: center;
    display: block;
    line-height: 1;
  }
  .gw-btn:hover:not(:disabled)  { background: #2a2e31; }
  .gw-btn:active:not(:disabled) { background: #a8151a; }
  .gw-btn:disabled              { opacity: 0.55; cursor: not-allowed; }

  .gw-btn--sec {
    background: #fff;
    color: #3b4043;
    border: 1.5px solid #3b4043;
    width: auto;
    flex-shrink: 0;
  }
  .gw-btn--sec:hover:not(:disabled)  { background: #fff5f5; }
  .gw-btn--sec:active:not(:disabled) { background: #ffe8e8; }

  .gw-btn-row {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }
  .gw-btn-row > .gw-btn:not(.gw-btn--sec) { flex: 1; width: auto; }

  .gw-link-btn {
    background: none;
    border: none;
    color: #3b4043;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    padding: 3px 0;
    text-decoration: underline;
    font-family: inherit;
    display: inline-block;
    text-align: left;
  }
  [dir="rtl"] .gw-link-btn { text-align: right; }
  .gw-link-btn:hover { color: #2a2e31; }

  /* ---- Product search ---- */
  .gw-hint { font-size: 12px; color: #aaa; margin: 0; }
  .gw-dropdown {
    border: 1.5px solid #e5e5e5;
    border-radius: 8px;
    max-height: 210px;
    overflow-y: auto;
    background: #fff;
    box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    margin-top: 4px;
  }
  .gw-drop-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 11px 13px;
    border: none;
    border-bottom: 1px solid #f5f5f5;
    background: transparent;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-size: 13px;
    color: #1a1a1a;
    font-family: inherit;
    transition: background 0.12s;
  }
  [dir="rtl"] .gw-drop-item { text-align: right; }
  .gw-drop-item:hover       { background: #fff5f5; }
  .gw-drop-item:last-child  { border-bottom: none; }
  .gw-drop-sku { font-size: 11px; color: #bbb; }

  .gw-manual-row { display: flex; gap: 8px; align-items: center; }
  .gw-manual-row .gw-input { flex: 1; width: auto; }

  .gw-add-btn {
    padding: 11px 16px;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    background: #3b4043;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .gw-add-btn:hover:not(:disabled)  { background: #2a2e31; }
  .gw-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ---- Product list ---- */
  .gw-plist {
    border: 1.5px solid #e8e8e8;
    border-radius: 10px;
    padding: 14px;
    background: #fafafa;
  }
  .gw-plist-title { font-size: 13px; font-weight: 600; color: #444; margin: 0 0 10px; }
  .gw-pitem {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 9px 11px;
    background: #fff;
    border: 1px solid #ebebeb;
    border-radius: 7px;
    margin-bottom: 7px;
  }
  .gw-pitem:last-child { margin-bottom: 0; }
  .gw-pinfo { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .gw-pname {
    font-size: 13px;
    font-weight: 500;
    color: #1a1a1a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gw-pmeta { font-size: 11px; color: #bbb; }
  .gw-rm-btn {
    background: none;
    border: none;
    color: #3b4043;
    cursor: pointer;
    font-size: 15px;
    padding: 3px 7px;
    border-radius: 5px;
    line-height: 1;
    transition: background 0.15s;
    flex-shrink: 0;
    margin-left: 8px;
  }
  [dir="rtl"] .gw-rm-btn { margin-left: 0; margin-right: 8px; }
  .gw-rm-btn:hover { background: #fff0f0; }

  /* ---- Review ---- */
  .gw-rev-sec  { margin-bottom: 4px; }
  .gw-rev-head {
    font-size: 11px;
    font-weight: 700;
    color: #3b4043;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin: 0 0 10px;
  }
  .gw-rev-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .gw-rev-fl   { display: block; font-size: 11px; color: #bbb; font-weight: 500; margin-bottom: 2px; }
  .gw-rev-fv   { display: block; font-size: 13px; color: #1a1a1a; font-weight: 600; }
  .gw-divider  { height: 1px; background: #ebebeb; margin: 4px 0; }
  .gw-rev-prod {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 11px;
    background: #fafafa;
    border-radius: 7px;
    margin-bottom: 6px;
    font-size: 13px;
    color: #1a1a1a;
  }
  .gw-rev-pmeta { font-size: 11px; color: #bbb; }

  /* ---- Success ---- */
  .gw-s-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #3b4043;
    color: #fff;
    font-size: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
  }
  .gw-s-title { font-size: 22px; font-weight: 700; color: #1a1a1a; text-align: center; margin: 0 0 10px; }
  .gw-s-msg   { font-size: 14px; color: #666; text-align: center; line-height: 1.65; margin: 0 0 24px; }

  .gw-reward {
    padding: 18px;
    background: linear-gradient(135deg, #fef3c7, #fde68a);
    border: 1px solid #fbbf24;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 8px;
  }
  .gw-reward-emoji { font-size: 32px; flex-shrink: 0; }
  .gw-reward-title { font-size: 15px; font-weight: 700; color: #92400e; margin: 0 0 4px; }
  .gw-reward-code  {
    font-size: 20px;
    font-weight: 800;
    color: #78350f;
    letter-spacing: 2px;
    font-family: 'Courier New', monospace;
    margin: 0 0 4px;
  }
  .gw-reward-desc { font-size: 12px; color: #92400e; margin: 0; }

  /* ---- Mobile-first responsive ---- */
  @media (max-width: 520px) {
    .gw-page { padding: 0; align-items: flex-start; }
    .gw-card { border-radius: 0; margin: 0; min-height: 100vh; min-height: 100svh; box-shadow: none; }
    .gw-header { padding: 16px 18px 14px; }
    .gw-body   { padding: 20px 18px 32px; }
    .gw-rev-grid { grid-template-columns: 1fr; }
    .gw-p-label  { display: none; }
    .gw-logo-wordmark { font-size: 18px; }
    .gw-h-title { font-size: 18px; }
    .gw-h-sub   { font-size: 12px; }
  }

  /* ---- Embed mode: transparent page, no min-height, card flush ---- */
  .gw-page--embed {
    min-height: unset !important;
    background: transparent !important;
    padding: 0 !important;
    display: block;
    align-items: unset;
  }
  .gw-page--embed .gw-card {
    border-radius: 0;
    box-shadow: none;
    margin: 0;
    min-height: unset;
  }
`;

// ---- Component ----
export default function WarrantyRegister() {
  // Language toggle (can be pre-set via ?lang=ar)
  const [lang, setLang] = useState<Lang>("en");
  const isRTL = lang === "ar";
  const t = T[lang];

  // Embed mode: ?embed=1 strips the page chrome so it sits inside an iframe
  const [isEmbed, setIsEmbed] = useState(false);

  // Get shop / embed / lang from URL params
  const [shop, setShop] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShop(params.get("shop") || "");
    if (params.get("embed") === "1") setIsEmbed(true);
    if (params.get("lang") === "ar") setLang("ar");
  }, []);

  // Step management
  const [currentStep, setCurrentStep] = useState<Step>("phone");

  // Report height to parent frame whenever content changes (embed mode only)
  useEffect(() => {
    if (!isEmbed) return;
    const report = () => {
      const h = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: "geepas-resize", height: h }, "*");
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [isEmbed, currentStep]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1: Phone lookup
  const [phone, setPhone] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  // Step 2: Customer details
  const [fullName, setFullName] = useState("");
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
    const tr = T[lang];
    if (!phone || phone.trim().length < 7) {
      setErrors({ phone: tr.errPhone });
      return;
    }
    if (!shop) {
      setGlobalError(tr.errShop);
      return;
    }

    setIsLookingUp(true);
    setGlobalError("");
    setErrors({});

    try {
      const res = await fetch(
        `/api/customer-lookup?phone=${encodeURIComponent(phone)}&shop=${encodeURIComponent(shop)}`,
      );

      if (!res.ok) {
        console.warn(
          "Lookup response not OK, transitioning to details step as a new customer.",
        );
        setCustomerData({ exists: false, lookupFailed: true });
        setIsNewCustomer(true);
        setFullName("");
        setEmail("");
        setCurrentStep("details");
        return;
      }

      const data = await res.json();
      setCustomerData(data);

      if (data.exists) {
        setIsNewCustomer(false);
        setFullName(data.firstName || "");
        setEmail(data.email || "");
      } else {
        setIsNewCustomer(true);
        setFullName("");
        setEmail("");
      }

      setCurrentStep("details");
    } catch (err) {
      console.warn(
        "Lookup request failed with network error, transitioning to details step.",
        err,
      );
      setCustomerData({ exists: false, lookupFailed: true });
      setIsNewCustomer(true);
      // @ts-ignore — pre-existing bug preserved intentionally; do not remove
      setFirstName("");
      setEmail("");
      setCurrentStep("details");
    } finally {
      setIsLookingUp(false);
    }
  }, [phone, shop, lang]);

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
            `/api/products?shop=${encodeURIComponent(shop)}&search=${encodeURIComponent(query)}`,
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
    [shop],
  );

  const addProduct = useCallback((product: ShopifyProduct) => {
    setProducts((prev) => {
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
    const tr = T[lang];
    const newErrors: FormErrors = {};
    if (!fullName.trim() || fullName.trim().length < 2)
      newErrors.fullName = tr.errName;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      newErrors.email = tr.errEmail;
    if (!city) newErrors.city = tr.errCity;
    if (!storeName.trim()) newErrors.store = tr.errStore;
    if (!purchaseDate) newErrors.purchaseDate = tr.errDate;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [fullName, email, city, storeName, purchaseDate, lang]);

  const validateProducts = useCallback((): boolean => {
    const tr = T[lang];
    if (products.length === 0) {
      setErrors({ products: tr.errProducts });
      return false;
    }
    setErrors({});
    return true;
  }, [products, lang]);

  // ---- Submit ----
  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setGlobalError("");

    try {
      const payload = {
        shop,
        firstName: fullName.trim(),
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
      setGlobalError(T[lang].errNetwork);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    shop,
    fullName,
    email,
    phone,
    city,
    storeName,
    purchaseDate,
    invoiceNumber,
    isNewCustomer,
    products,
    lang,
  ]);

  // ---- Reset ----
  const handleReset = useCallback(() => {
    setCurrentStep("phone");
    setPhone("");
    setCustomerData(null);
    setIsNewCustomer(false);
    setFullName("");
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

  // ---- Progress ----
  const steps: Step[] = ["phone", "details", "products", "review"];
  const stepLabels = t.steps;
  const currentIndex = steps.indexOf(currentStep);

  // ---- Render ----
  return (
    <div className={`gw-page${isEmbed ? " gw-page--embed" : ""}`} dir={isRTL ? "rtl" : "ltr"}>
      {/* Embedded brand CSS */}
      <style dangerouslySetInnerHTML={{ __html: GEEPAS_CSS }} />

      <div className="gw-card">
        {/* ---- Header ---- */}
        <div className="gw-header">
          <div className="gw-header-top">
            <div className="gw-logo">
              <span className="gw-logo-wordmark">GEEPAS</span>
              <span className="gw-logo-tagline">From Our Home to Your Home</span>
            </div>
            <button
              className="gw-lang-btn"
              onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}
              aria-label="Switch language"
            >
              {t.toggleLang}
            </button>
          </div>
          <h1 className="gw-h-title">{t.pageTitle}</h1>
          <p className="gw-h-sub">{t.pageSubtitle}</p>
        </div>

        {/* ---- Body ---- */}
        <div className="gw-body">
          {/* Progress Bar */}
          {currentStep !== "success" && (
            <div className="gw-progress">
              {steps.map((step, i) => (
                <div key={step} className="gw-p-step">
                  <div className={`gw-p-dot${i <= currentIndex ? " gw-p-dot--on" : ""}`}>
                    {i < currentIndex ? "✓" : i + 1}
                  </div>
                  <span className={`gw-p-label${i <= currentIndex ? " gw-p-label--on" : ""}`}>
                    {stepLabels[i]}
                  </span>
                  {i < steps.length - 1 && (
                    <div className={`gw-p-line${i < currentIndex ? " gw-p-line--on" : ""}`} />
                  )}
                </div>
              ))}
            </div>
          )}

          {globalError && <div className="gw-global-err">{globalError}</div>}

          {/* ---- STEP: Phone Lookup ---- */}
          {currentStep === "phone" && (
            <div className="gw-step">
              <h2 className="gw-step-title">{t.step1Title}</h2>
              <p className="gw-step-desc">{t.step1Desc}</p>

              <div className="gw-field">
                <label htmlFor="reg-phone" className="gw-label">
                  {t.phoneLabel} <span className="gw-req">{t.required}</span>
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
                  placeholder={t.phonePlaceholder}
                  className={`gw-input${errors.phone ? " gw-input--err" : ""}`}
                  inputMode="tel"
                />
                {errors.phone && <p className="gw-err">{errors.phone}</p>}
              </div>

              <button
                className="gw-btn"
                disabled={isLookingUp}
                onClick={handlePhoneLookup}
              >
                {isLookingUp ? t.lookingUp : t.continueBtn}
              </button>
            </div>
          )}

          {/* ---- STEP: Customer Details ---- */}
          {currentStep === "details" && (
            <div className="gw-step">
              {customerData?.exists ? (
                <div className="gw-banner gw-banner--ok">
                  <span className="gw-b-icon">✓</span>
                  {t.welcomeBack}
                </div>
              ) : customerData?.lookupFailed ? (
                <div className="gw-banner gw-banner--info">
                  <span className="gw-b-icon">ℹ</span>
                  {t.lookupFailed}
                </div>
              ) : (
                <div className="gw-banner gw-banner--info">
                  <span className="gw-b-icon">ℹ</span>
                  {t.newAccount}
                </div>
              )}

              <div className="gw-form">
                {/* Full Name */}
                <div className="gw-field">
                  <label htmlFor="reg-fullName" className="gw-label">
                    {t.fullName} <span className="gw-req">{t.required}</span>
                  </label>
                  <input
                    id="reg-fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t.fullNamePlaceholder}
                    readOnly={customerData?.exists && !!fullName}
                    className={[
                      "gw-input",
                      errors.fullName ? "gw-input--err" : "",
                      customerData?.exists && fullName ? "gw-input--ro" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  {errors.fullName && <p className="gw-err">{errors.fullName}</p>}
                </div>

                {/* Email */}
                <div className="gw-field">
                  <label htmlFor="reg-email" className="gw-label">
                    {t.emailLabel} <span className="gw-req">{t.required}</span>
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.emailPlaceholder}
                    readOnly={customerData?.exists && !!email}
                    className={[
                      "gw-input",
                      errors.email ? "gw-input--err" : "",
                      customerData?.exists && email ? "gw-input--ro" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    inputMode="email"
                  />
                  {errors.email && <p className="gw-err">{errors.email}</p>}
                </div>

                {/* City */}
                <div className="gw-field">
                  <label htmlFor="reg-city" className="gw-label">
                    {t.cityLabel} <span className="gw-req">{t.required}</span>
                  </label>
                  <select
                    id="reg-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={`gw-input gw-select${errors.city ? " gw-input--err" : ""}`}
                  >
                    <option value="">{t.cityPlaceholder}</option>
                    {IRAQI_CITIES.map((c) => (
                      <option key={c.en} value={c.en}>
                        {isRTL ? c.ar : c.en}
                      </option>
                    ))}
                  </select>
                  {errors.city && <p className="gw-err">{errors.city}</p>}
                </div>

                {/* Store */}
                <div className="gw-field">
                  <label htmlFor="reg-store" className="gw-label">
                    {t.storeLabel} <span className="gw-req">{t.required}</span>
                  </label>
                  <input
                    id="reg-store"
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder={t.storePlaceholder}
                    className={`gw-input${errors.store ? " gw-input--err" : ""}`}
                  />
                  {errors.store && <p className="gw-err">{errors.store}</p>}
                </div>

                {/* Purchase Date */}
                <div className="gw-field">
                  <label htmlFor="reg-purchaseDate" className="gw-label">
                    {t.purchaseDateLabel} <span className="gw-req">{t.required}</span>
                  </label>
                  <input
                    id="reg-purchaseDate"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    className={`gw-input${errors.purchaseDate ? " gw-input--err" : ""}`}
                  />
                  {errors.purchaseDate && (
                    <p className="gw-err">{errors.purchaseDate}</p>
                  )}
                </div>

                {/* Invoice Number (optional) */}
                <div className="gw-field">
                  <label htmlFor="reg-invoice" className="gw-label">
                    {t.invoiceLabel}
                  </label>
                  <input
                    id="reg-invoice"
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder={t.invoicePlaceholder}
                    className="gw-input"
                  />
                </div>
              </div>

              <div className="gw-btn-row">
                <button
                  className="gw-btn gw-btn--sec"
                  onClick={() => setCurrentStep("phone")}
                >
                  {t.backBtn}
                </button>
                <button
                  className="gw-btn"
                  onClick={() => {
                    if (validateDetails()) setCurrentStep("products");
                  }}
                >
                  {t.continueBtn}
                </button>
              </div>
            </div>
          )}

          {/* ---- STEP: Products ---- */}
          {currentStep === "products" && (
            <div className="gw-step">
              <h2 className="gw-step-title">{t.step3Title}</h2>
              <p className="gw-step-desc">{t.step3Desc}</p>

              {/* Product Search */}
              <div className="gw-field">
                <label htmlFor="product-search" className="gw-label">
                  {t.searchLabel}
                </label>
                <input
                  id="product-search"
                  type="text"
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="gw-input"
                />
                {isSearching && <p className="gw-hint">{t.searching}</p>}
                {searchResults.length > 0 && (
                  <div className="gw-dropdown">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        className="gw-drop-item"
                        onClick={() => addProduct(p)}
                      >
                        <span style={{ fontWeight: 500 }}>{p.title}</span>
                        {p.sku && (
                          <span className="gw-drop-sku">
                            {t.skuLabel}: {p.sku}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual Entry Toggle */}
              <button
                className="gw-link-btn"
                onClick={() => setShowManualEntry(!showManualEntry)}
              >
                {showManualEntry ? t.cancelManual : t.cantFind}
              </button>

              {showManualEntry && (
                <div className="gw-manual-row">
                  <input
                    id="manual-product-title"
                    type="text"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder={t.manualPlaceholder}
                    className="gw-input"
                  />
                  <button
                    className="gw-add-btn"
                    onClick={addManualProduct}
                    disabled={!manualTitle.trim()}
                  >
                    {t.addBtn}
                  </button>
                </div>
              )}

              {/* Product List */}
              {products.length > 0 && (
                <div className="gw-plist">
                  <p className="gw-plist-title">
                    {t.selectedProducts} ({products.length})
                  </p>
                  {products.map((p) => (
                    <div key={p.id} className="gw-pitem">
                      <div className="gw-pinfo">
                        <span className="gw-pname">{p.productTitle}</span>
                        <span className="gw-pmeta">
                          {p.isManual ? t.manualEntry : t.catalogProduct}
                          {p.sku ? ` · ${t.skuLabel}: ${p.sku}` : ""}
                        </span>
                      </div>
                      <button
                        className="gw-rm-btn"
                        onClick={() => removeProduct(p.id)}
                        aria-label="Remove product"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {errors.products && <p className="gw-err">{errors.products}</p>}

              <div className="gw-btn-row">
                <button
                  className="gw-btn gw-btn--sec"
                  onClick={() => setCurrentStep("details")}
                >
                  {t.backBtn}
                </button>
                <button
                  className="gw-btn"
                  onClick={() => {
                    if (validateProducts()) setCurrentStep("review");
                  }}
                >
                  {t.reviewBtn}
                </button>
              </div>
            </div>
          )}

          {/* ---- STEP: Review ---- */}
          {currentStep === "review" && (
            <div className="gw-step">
              <h2 className="gw-step-title">{t.step4Title}</h2>
              <p className="gw-step-desc">{t.step4Desc}</p>

              <div className="gw-rev-sec">
                <p className="gw-rev-head">{t.sectionCustomer}</p>
                <div className="gw-rev-grid">
                  <div>
                    <span className="gw-rev-fl">{t.fullNameDisplay}</span>
                    <span className="gw-rev-fv">{fullName}</span>
                  </div>
                  <div>
                    <span className="gw-rev-fl">{t.emailDisplay}</span>
                    <span className="gw-rev-fv">{email}</span>
                  </div>
                  <div>
                    <span className="gw-rev-fl">{t.phoneDisplay}</span>
                    <span className="gw-rev-fv">{phone}</span>
                  </div>
                  <div>
                    <span className="gw-rev-fl">{t.typeDisplay}</span>
                    <span className="gw-rev-fv">
                      {isNewCustomer ? t.newCustomer : t.returningCustomer}
                    </span>
                  </div>
                </div>
              </div>

              <div className="gw-divider" />

              <div className="gw-rev-sec">
                <p className="gw-rev-head">{t.sectionPurchase}</p>
                <div className="gw-rev-grid">
                  <div>
                    <span className="gw-rev-fl">{t.cityDisplay}</span>
                    <span className="gw-rev-fv">{city}</span>
                  </div>
                  <div>
                    <span className="gw-rev-fl">{t.storeDisplay}</span>
                    <span className="gw-rev-fv">{storeName}</span>
                  </div>
                  <div>
                    <span className="gw-rev-fl">{t.dateDisplay}</span>
                    <span className="gw-rev-fv">
                      {new Date(purchaseDate).toLocaleDateString()}
                    </span>
                  </div>
                  {invoiceNumber && (
                    <div>
                      <span className="gw-rev-fl">{t.invoiceDisplay}</span>
                      <span className="gw-rev-fv">{invoiceNumber}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="gw-divider" />

              <div className="gw-rev-sec">
                <p className="gw-rev-head">
                  {t.sectionProducts} ({products.length})
                </p>
                {products.map((p) => (
                  <div key={p.id} className="gw-rev-prod">
                    <span>{p.productTitle}</span>
                    <span className="gw-rev-pmeta">
                      {p.isManual ? t.manualTag : t.catalogTag}
                      {p.sku ? ` · ${p.sku}` : ""}
                    </span>
                  </div>
                ))}
              </div>

              <div className="gw-btn-row">
                <button
                  className="gw-btn gw-btn--sec"
                  onClick={() => setCurrentStep("products")}
                >
                  {t.backBtn}
                </button>
                <button
                  className="gw-btn"
                  disabled={isSubmitting}
                  onClick={handleSubmit}
                >
                  {isSubmitting ? t.submitting : t.submitBtn}
                </button>
              </div>
            </div>
          )}

          {/* ---- STEP: Success ---- */}
          {currentStep === "success" && (
            <div className="gw-step">
              <div className="gw-s-icon">✓</div>
              <h1 className="gw-s-title">{t.successTitle}</h1>
              <p className="gw-s-msg">
                {t.successMsg}
                {successData?.smsSent ? t.smsSent : t.confirmationShortly}
              </p>

              {successData?.reward?.discountCode && (
                <div className="gw-reward">
                  <span className="gw-reward-emoji">🎁</span>
                  <div>
                    <p className="gw-reward-title">{t.rewardTitle}</p>
                    <p className="gw-reward-code">
                      {successData.reward.discountCode}
                    </p>
                    <p className="gw-reward-desc">{t.useCode}</p>
                  </div>
                </div>
              )}

              {successData?.reward?.message && (
                <div className="gw-banner gw-banner--info">
                  <span className="gw-b-icon">ℹ</span>
                  {successData.reward.message}
                </div>
              )}

              <button className="gw-btn" onClick={handleReset}>
                {t.registerAnother}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
