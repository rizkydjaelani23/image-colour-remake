-- AlterTable: track whether a support conversation has been escalated to a person.
-- false by default, so every existing conversation behaves exactly as before.
ALTER TABLE "SupportConversation" ADD COLUMN IF NOT EXISTS "humanRequested" BOOLEAN NOT NULL DEFAULT false;
