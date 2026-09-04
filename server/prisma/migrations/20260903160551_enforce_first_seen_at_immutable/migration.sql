-- The entire "existing jobs must not notify a newly-subscribed user" rule
-- rests on firstSeenAt being the moment JobDrop first saw a job, and never
-- moving afterwards. A re-sync, a backfill script, or an ORM call that
-- happens to include the column in an UPDATE would silently re-date old
-- jobs as brand-new and flood every subscriber. "No code path updates it"
-- is a convention; this makes it an invariant the database enforces.

CREATE OR REPLACE FUNCTION jobs_first_seen_at_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."firstSeenAt" IS DISTINCT FROM OLD."firstSeenAt" THEN
    RAISE EXCEPTION
      'jobs.firstSeenAt is write-once (job %: % -> %)',
      OLD.id, OLD."firstSeenAt", NEW."firstSeenAt";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_first_seen_at_immutable
BEFORE UPDATE ON "jobs"
FOR EACH ROW
EXECUTE FUNCTION jobs_first_seen_at_is_immutable();
