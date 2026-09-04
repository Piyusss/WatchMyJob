-- discoveredInInitialSync is the only thing that protects a subscriber from
-- a flood when a NEW source is added to an already-live company (firstSeenAt
-- alone is not enough there -- see the Job model's comment in schema.prisma).
-- No code path updates it today, but that is a convention, exactly like
-- firstSeenAt was before the previous migration made it a database-enforced
-- invariant. Extend the same trigger to cover this flag too, so a future
-- change can't silently flip it and reopen the hole it exists to close.

CREATE OR REPLACE FUNCTION jobs_first_seen_at_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."firstSeenAt" IS DISTINCT FROM OLD."firstSeenAt" THEN
    RAISE EXCEPTION
      'jobs.firstSeenAt is write-once (job %: % -> %)',
      OLD.id, OLD."firstSeenAt", NEW."firstSeenAt";
  END IF;
  IF NEW."discoveredInInitialSync" IS DISTINCT FROM OLD."discoveredInInitialSync" THEN
    RAISE EXCEPTION
      'jobs.discoveredInInitialSync is write-once (job %: % -> %)',
      OLD.id, OLD."discoveredInInitialSync", NEW."discoveredInInitialSync";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
