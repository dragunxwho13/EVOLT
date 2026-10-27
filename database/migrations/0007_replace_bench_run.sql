-- The Arduino bench log was replaced by run 2 (database/data/arduino-bench-run-2.csv). Readings of
-- the earlier run are removed so that no page, API or model can use them; run 2 is loaded by
-- database/seed/bench.ts.
DELETE FROM "bench_readings" WHERE "run_id" <> 'bench-run-2';
