-- Record search (F1.6, D-25). Hand-written functions first; the rest is generated.
-- Both functions are IMMUTABLE so a generated column can use them, and they name their own
-- functions with `public.` because a restore (pg_dump) runs with an empty search_path.
--
-- The plain text of a rich text document (D-22, TipTap JSON): text nodes and mention labels,
-- with a paragraph's or heading's inline nodes joined directly (so "Mi" + bold "ra" stays
-- "Mira") and everything else joined with a space. Mirrors `richTextToPlainText` in the shared
-- package.
CREATE FUNCTION public.stagehand_rich_text_plain(node jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  kind text := node ->> 'type';
BEGIN
  IF kind = 'text' THEN
    RETURN coalesce(node ->> 'text', '');
  ELSIF kind = 'mention' THEN
    RETURN coalesce(node #>> '{attrs,label}', '');
  ELSIF kind = 'hardBreak' THEN
    RETURN ' ';
  ELSIF jsonb_typeof(node -> 'content') IS DISTINCT FROM 'array' THEN
    RETURN '';
  END IF;
  RETURN coalesce(
    (SELECT string_agg(
              public.stagehand_rich_text_plain(child),
              CASE WHEN kind IN ('paragraph', 'heading') THEN '' ELSE ' ' END
              ORDER BY position)
       FROM jsonb_array_elements(node -> 'content') WITH ORDINALITY AS c(child, position)),
    '');
END
$$;--> statement-breakpoint
-- What search matches: name and tags (weight A), public description (B), GM notes (C). The
-- `simple` config lower-cases words without stemming, so homebrew names stay as written.
CREATE FUNCTION public.stagehand_record_search_vector(
  name text, tags text[], public_description jsonb, gm_notes jsonb
) RETURNS tsvector
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  RETURN setweight(to_tsvector('pg_catalog.simple', coalesce(name, '')), 'A')
    || setweight(to_tsvector('pg_catalog.simple', coalesce(array_to_string(tags, ' '), '')), 'A')
    || setweight(to_tsvector('pg_catalog.simple',
         coalesce(public.stagehand_rich_text_plain(public_description), '')), 'B')
    || setweight(to_tsvector('pg_catalog.simple',
         coalesce(public.stagehand_rich_text_plain(gm_notes), '')), 'C');
END
$$;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (public.stagehand_record_search_vector(name, tags, public_description, gm_notes)) STORED;--> statement-breakpoint
CREATE INDEX "records_search_vector_idx" ON "records" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "records_name_trgm_idx" ON "records" USING gin ("name" gin_trgm_ops);
