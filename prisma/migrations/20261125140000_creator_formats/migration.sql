-- AlterTable
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "publishesLongForm" BOOLEAN;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "publishesShorts" BOOLEAN;
