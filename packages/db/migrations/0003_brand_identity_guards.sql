-- Brand Identity versions are immutable from 'approved' on (spec: "versioni immutabili").
-- Only the lifecycle columns may still move: approved -> published -> archived.
CREATE OR REPLACE FUNCTION brand_versions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('approved', 'published', 'archived') THEN
    IF NEW.document IS DISTINCT FROM OLD.document
      OR NEW.tokens IS DISTINCT FROM OLD.tokens
      OR NEW.number IS DISTINCT FROM OLD.number
      OR NEW.brand_identity_id IS DISTINCT FROM OLD.brand_identity_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.changelog IS DISTINCT FROM OLD.changelog
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.approval_note IS DISTINCT FROM OLD.approval_note
      OR NEW.rev IS DISTINCT FROM OLD.rev THEN
      RAISE EXCEPTION 'brand_identity_versions %: version % is % and immutable', OLD.id, OLD.number, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'approved' AND NEW.status IN ('published', 'archived'))
      OR (OLD.status = 'published' AND NEW.status = 'archived')
    ) THEN
      RAISE EXCEPTION 'brand_identity_versions %: transition % -> % not allowed', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'approved' AND (
      NEW.published_by IS DISTINCT FROM OLD.published_by
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
    ) THEN
      RAISE EXCEPTION 'brand_identity_versions %: publication data is immutable', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER brand_versions_guard
  BEFORE UPDATE ON brand_identity_versions
  FOR EACH ROW EXECUTE FUNCTION brand_versions_guard();
