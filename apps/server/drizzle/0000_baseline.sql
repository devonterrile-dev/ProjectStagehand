-- Baseline (F0.3). No tables yet: Better Auth's arrive with F0.4.
-- pg_trgm provides trigram similarity, for record search (F1.6) and duplicate-name
-- flagging in AI import review (F1.8). It is a trusted extension, so the database owner
-- can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
