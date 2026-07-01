-- Add dedupeKey to SMSLog for idempotent order-triggered SMS sends.
-- Nullable so existing warranty-registration rows (which have no key) are unaffected.

ALTER TABLE "SMSLog" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "SMSLog_dedupeKey_key" ON "SMSLog"("dedupeKey");
