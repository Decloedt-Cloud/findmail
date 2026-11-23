CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Creator" ADD COLUMN "embedding" vector(768);
ALTER TABLE "Creator" ADD COLUMN "embeddingModel" TEXT;
ALTER TABLE "Creator" ADD COLUMN "embeddingHash" TEXT;

CREATE INDEX "Creator_embedding_hnsw" ON "Creator" USING hnsw ("embedding" vector_cosine_ops);
