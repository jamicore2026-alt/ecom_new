-- 0034_timestamptz: convert every `timestamp without time zone` column to
-- timestamptz. Wall-clock values are interpreted in the database's own
-- timezone (UTC on all provisioned environments — verified), so instants are
-- preserved exactly. Fully idempotent: a second run finds no matching columns.
-- NOTE: the next `drizzle-kit generate` will diff schema.ts (tstz helper)
-- against the 0031 snapshot and re-emit this DDL — discard/merge that output.
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE current_setting(%L)',
      r.table_name, r.column_name, r.column_name, 'TIMEZONE'
    );
  END LOOP;
END $$;
