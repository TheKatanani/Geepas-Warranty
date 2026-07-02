/**
 * Runs before every test file is imported. Provides fallback env vars so that
 * if any module reads process.env at import time (e.g. infobip.server.ts's
 * top-level INFOBIP_* consts, or shopify.server.ts's shopifyApp() call), it
 * never touches real credentials — even if a test forgets to mock it out.
 */
process.env.INFOBIP_API_KEY ??= "test-infobip-key";
process.env.INFOBIP_BASE_URL ??= "https://test.infobip.example";
process.env.INFOBIP_SENDER ??= "GEEPAS-TEST";

process.env.SHOPIFY_API_KEY ??= "test-shopify-api-key";
process.env.SHOPIFY_API_SECRET ??= "test-shopify-api-secret";
process.env.SCOPES ??= "read_customers,write_customers";
process.env.SHOPIFY_APP_URL ??= "https://test.example.com";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
