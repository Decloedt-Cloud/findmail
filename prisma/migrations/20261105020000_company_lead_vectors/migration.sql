CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "company_lead_vectors" (
    "domain" TEXT NOT NULL,
    "sic_name" TEXT,
    "embedding" vector(512) NOT NULL,

    CONSTRAINT "company_lead_vectors_pkey" PRIMARY KEY ("domain")
);

CREATE INDEX "company_lead_vectors_embedding_hnsw"
    ON "company_lead_vectors"
    USING hnsw ("embedding" vector_cosine_ops);
