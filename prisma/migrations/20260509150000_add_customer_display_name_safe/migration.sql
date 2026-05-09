-- Safe migration: adds customerDisplayName column only if it doesn't already exist
ALTER TABLE "Preview" ADD COLUMN IF NOT EXISTS "customerDisplayName" TEXT;
