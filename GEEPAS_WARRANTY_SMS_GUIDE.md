# Geepas Warranty App — SMS Delivery Guide

## Architecture Overview

```
Customer fills warranty form
        │
        ▼
POST /api/warranty                          PHASE 1 — REGISTRATION
  • Creates/finds Shopify customer
  • Adds tag: warranty-registered
  • Saves WarrantyRegistration to DB
  • Does NOT create CustomerReward yet
    (discount code doesn't exist yet)
  • Returns success to customer
        │
        ▼
Shopify Flow triggers on customer creation  PHASE 2 — FLOW
  Condition: tags contains "warranty-registered"
  ├─ TRUE  → discountCodeBasicCreate (WARRANTY15)
  │          → tagsAdd: voucher-ready:WARRANTY15:WARRANTY15-{id}
  └─ FALSE → discountCodeBasicCreate (WELCOME10)
             → tagsAdd: voucher-ready:WELCOME10:WELCOME10-{id}
        │
        ▼
Shopify fires CUSTOMERS_UPDATE webhook      PHASE 3 — DELIVERY
        │
        ▼
webhooks.customers.update.tsx
  • Detects voucher-ready:<TIER>:<CODE> tag
  • Queries DB for latest registration (phone, product name)
  • Calls sendWarrantySms() via Infobip
  • Writes result to SMSLog
  • ✅ Creates CustomerReward (code now exists)
  • Removes voucher-ready tag (prevents re-fire)
```

### When each record is created

| Record              | Created in         | Reason                                      |
|---------------------|--------------------|---------------------------------------------|
| `WarrantyRegistration` | `/api/warranty`  | Immediately on form submit                  |
| `CustomerReward`    | webhook            | Only after Flow generates the discount code |
| `SMSLog`            | webhook            | After every SMS attempt (success or failure)|

---

## Voucher Tag Format

Shopify Flow embeds the discount code directly in the tag:

```
voucher-ready:WARRANTY15:WARRANTY15-12345678
              ─────┬────  ────────────┬──────
                   │                  └─ discount code
                   └─ tier (maps to SMS template)
```

Supported tiers:

| Tier       | Trigger                          | Discount |
|------------|----------------------------------|----------|
| WARRANTY15 | Customer has `warranty-registered` tag | 15% off  |
| WELCOME10  | New customer without warranty tag | 10% off  |
| NEXT15     | (Future) Second purchase          | 15% off  |
| SECOND15   | (Future) Repeat buyer             | 15% off  |

---

## Environment Variables

Set these in Vercel → Project → Settings → Environment Variables:

| Variable            | Description                                      | Example                            |
|---------------------|--------------------------------------------------|------------------------------------|
| `INFOBIP_API_KEY`   | Infobip API key                                  | `abc123...`                        |
| `INFOBIP_BASE_URL`  | Infobip base URL (from your Infobip dashboard)   | `https://8pmk3.api.infobip.com`    |
| `INFOBIP_SENDER`    | Sender ID registered with Infobip                | `LUFIAN`                           |
| `SHOPIFY_API_KEY`   | Shopify app API key                              | from Partners dashboard            |
| `SHOPIFY_API_SECRET`| Shopify app secret (used to verify webhooks)     | from Partners dashboard            |
| `SHOPIFY_APP_URL`   | Your Vercel deployment URL                       | `https://your-app.vercel.app`      |
| `DATABASE_URL`      | Postgres connection string (pooled)              | from Supabase/Neon                 |
| `DIRECT_URL`        | Postgres direct connection string                | from Supabase/Neon                 |

---

## Webhook Registration

The `CUSTOMERS_UPDATE` webhook must be registered with Shopify. The Shopify App Remix framework
handles this automatically on app install/re-auth. To verify it's registered:

1. Go to **Shopify Partners** → your app → **Webhooks**
2. Confirm `customers/update` points to:
   `https://your-app.vercel.app/webhooks/customers/update`

If it's missing, re-install the app on your store or trigger auth by visiting the app in the Shopify admin.

---

## Shopify Flow Setup

### Step 1 — Trigger
- **Trigger:** Customer created

### Step 2 — Condition
- **Condition:** Customer tags **is equal to** `warranty-registered`

### Step 3a — True branch (WARRANTY15)
1. **Send Admin API request** → `discountCodeBasicCreate` mutation
   - Code: `WARRANTY15-{{ customer.legacyResourceId }}`
   - Value: 15% percentage discount
   - Usage limit: 1 per customer
2. **Add customer tags:**
   `voucher-ready:WARRANTY15:WARRANTY15-{{ customer.legacyResourceId }}`

### Step 3b — False branch (WELCOME10)
1. **Send Admin API request** → `discountCodeBasicCreate` mutation
   - Code: `WELCOME10-{{ customer.legacyResourceId }}`
   - Value: 10% percentage discount
   - Usage limit: 1 per customer
2. **Add customer tags:**
   `voucher-ready:WELCOME10:WELCOME10-{{ customer.legacyResourceId }}`

---

## SMS Message Format

Messages are sent in Arabic by default. Example output:

```
مرحباً Ahmed،

شكراً لتسجيل ضمان Geepas Air Fryer
رقم الضمان: a1b2c3d4-...
مدة الضمان: 365 يوم
تاريخ التسجيل: ١٥ يناير ٢٠٢٦
كود الخصم الخاص بك: WARRANTY15-12345678
صلاحيته: 30 يوم

استخدم الكود عند الشراء
```

English fallback is available by passing `lang: "en"` to `sendWarrantySms()`.

---

## Database: SMSLog Table

Every SMS attempt (success or failure) is written to `SMSLog`:

| Column                | Description                                      |
|-----------------------|--------------------------------------------------|
| `id`                  | UUID                                             |
| `shop`                | Shopify shop domain                              |
| `phone`               | Normalized E.164 phone                           |
| `registrationId`      | FK to WarrantyRegistration (nullable)            |
| `smsSent`             | `true` if Infobip accepted the message           |
| `smsSentAt`           | Timestamp of successful send                     |
| `smsProviderResponse` | Raw Infobip response or error string             |

Query failed sends:
```sql
SELECT * FROM "SMSLog" WHERE "smsSent" = false ORDER BY "smsSentAt" DESC;
```

---

## Phone Number Normalization

`normalizePhone()` in `app/utils/twilio.server.ts` converts any Iraqi format to E.164:

| Input          | Output          |
|----------------|-----------------|
| `07701234567`  | `+9647701234567`|
| `7701234567`   | `+9647701234567`|
| `+9647701234567`| `+9647701234567`|
| `009647701234567`| `+9647701234567`|

---

## Infobip Deduplication

`sendWarrantySms()` has a 5-minute deduplication window per phone number (in-memory).
If the CUSTOMERS_UPDATE webhook fires twice for the same customer within 5 minutes,
the second SMS is suppressed. The SMSLog will show `smsSent: false` with an error message
containing "Duplicate suppressed".

---

## Vercel Cron (Deprecated)

`vercel.json` still contains a cron entry for `/cron.process-vouchers` running every 2 minutes.
This is now a no-op — the route returns immediately with a deprecation message.

**On Vercel Hobby plan:** the cron never ran anyway (Hobby plan does not support cron jobs).

You can safely remove the cron entry from `vercel.json` once the webhook path is confirmed working:

```json
// Remove this block from vercel.json:
"crons": [
  {
    "path": "/cron.process-vouchers",
    "schedule": "*/2 * * * *"
  }
]
```

---

## Testing

### Manual webhook test (curl)

Simulate Shopify firing CUSTOMERS_UPDATE with a voucher tag:

```bash
# Replace <HMAC> with a valid HMAC or temporarily bypass auth for testing
curl -X POST https://your-app.vercel.app/webhooks/customers/update \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: customers/update" \
  -H "X-Shopify-Shop-Domain: your-store.myshopify.com" \
  -H "X-Shopify-Hmac-Sha256: <HMAC>" \
  -d '{
    "id": 12345678,
    "first_name": "Ahmed",
    "phone": "+9647701234567",
    "tags": "warranty-registered, voucher-ready:WARRANTY15:WARRANTY15-12345678"
  }'
```

### Verify in Vercel logs

Vercel Dashboard → your project → **Logs** → filter by `webhooks.customers.update`

Expected log sequence:
```
[customers/update] received for shop=ae53cd-2.myshopify.com
[customers/update] Sending voucher SMS to +9647701234567 code=WARRANTY15-12345678
[Infobip] Attempt 1/3 → +9647701234567 (reg: ...)
[Infobip] ✓ Sent to +9647701234567, messageId=...
[customers/update] SMS sent. messageId=...
[customers/update] Removed tag "voucher-ready:WARRANTY15:WARRANTY15-12345678" from customer 12345678
```

### Check SMSLog in database

```sql
SELECT phone, "smsSent", "smsSentAt", "smsProviderResponse"
FROM "SMSLog"
ORDER BY "smsSentAt" DESC
LIMIT 10;
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No SMS received, no SMSLog entry | Webhook not registered | Re-install app or check Partners dashboard |
| SMSLog entry with `smsSent: false` and Infobip error | Bad API key or sender ID | Check `INFOBIP_API_KEY`, `INFOBIP_SENDER` env vars |
| "Duplicate suppressed" in logs | Webhook fired twice < 5 min | Normal — only one SMS was needed |
| SMS sent but wrong phone | Phone not on Shopify customer | Verify `/api/warranty` is storing phone on Shopify customer object |
| Tag not removed after SMS | GraphQL mutation failed | Check Vercel logs for tag removal error; safe to remove tag manually in Shopify admin |
| `voucher-ready` tag missing | Flow not configured | Check Flow branches add the tag with correct format |
