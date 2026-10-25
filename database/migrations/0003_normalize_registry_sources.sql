-- Keep imported station records provider-neutral in the application.
-- The importer and public UI use the generic registry label going forward.
UPDATE stations
SET source = 'Imported station registry',
    updated_at = now()
WHERE source IS NOT NULL
  AND lower(source) LIKE '%charge%map%';
