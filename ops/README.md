# ops/ - archive and recovery tools

## archive_costos.py - verified archive of the whole database to a OneDrive folder

Why: the Free plan has no downloadable backups, and `costos_piscina` keeps ~32k rows per daily
snapshot (about 99% identical to the day before). Before old snapshots are pruned from Supabase,
a verified copy must exist outside Supabase.

What it does: reads everything in one consistent, read-only snapshot, writes one `.csv.gz` per
table (`costos_piscina` split per month), reads each file back and checks the row count and the
sum of `valor` against the database, and writes `manifest.json` (rows, bytes, SHA-256 per file).
It skips the `usuarios` table (personal data). It never prints or stores the database password.

### Run it on the NUC (Windows, PowerShell)

1. Install the one dependency:
   ```powershell
   py -m pip install "psycopg[binary]"
   ```
2. In Supabase Dashboard, click **Connect** and copy the **Session pooler** connection string
   (port 5432; the direct host is IPv6-only on the Free plan). Put your database password in it
   (Project Settings > Database > Reset database password, if you do not have it; the robot's
   REST calls do not use the database password).
3. Run the export into a OneDrive folder:
   ```powershell
   $env:SUPABASE_DB_URL = "<paste the connection string here>"
   py ops\archive_costos.py --out "C:\Users\YOU\OneDrive - Lukmar\Archivo Supabase\2026-11-06" --also-copy-to "D:\Respaldos\supabase_2026-11-06"
   ```
   The last lines must say `ARCHIVE VERIFIED OK`. The exit code is 0 only when everything matched.
   It transfers roughly 0.5 GB from Supabase: run it once, not repeatedly.
4. Wait until OneDrive shows the folder as fully synced (green check), then verify the synced copy
   (no database needed):
   ```powershell
   py ops\archive_costos.py --verify "C:\Users\YOU\OneDrive - Lukmar\Archivo Supabase\2026-11-06"
   ```
   It must say `VERIFY OK`.

The archive is still recommended (the Free plan has no downloadable backups), but it is no longer a precondition for
the prune: see the next section. It exports `costos_hist` like any other table.

### Cost history and the daily prune (DONE on 2026-11-07)

On 2026-11-06 the database was 1,421 MB on a 500 MB plan (the API answered HTTP 402 `exceed_db_size_quota`, and a
query failed with "No space left on device"). Without waiting for the archive, the old daily snapshots were not deleted
blindly: each one was first saved in a compact, lossless change-log and verified.

- `costos_piscina` now keeps only the **newest 7 snapshot dates** in full (about 40 MB).
- `costos_hist` keeps every older day as "only the rows that changed" (about 280 MB); `costos_hist_fechas` holds a
  fingerprint of each original snapshot. Rebuild any past day with `select * from costos_asof('2026-07-15');`
  (heavy: it takes a minute or two on the Free plan; use it for investigations, not in the dashboard).
- Verified: 121 of 121 dates, once when saved and once independently from the stored data; a deliberately corrupted
  entry was detected. The prune ran in one transaction that compared fingerprints and would have rolled back otherwise.
  Not preserved: the surrogate columns `id` and `created_at` of the old rows.
- `public.mantener_costos()` runs daily at 12:00 UTC (pg_cron job `mantener-costos`): it saves new old dates into the
  history and deletes full snapshots outside the 7-date window, only if the original rows and the stored entries still
  match their checksums (anything else is reported in `conflictos`, not deleted).
- **Runway:** the history grows about 3 MB per day. The database is about 375 MB now, so it reaches the 500 MB limit in
  roughly five weeks unless the oldest history is archived (this tool) and trimmed from the database.
- If the robot re-imports an old file, `mantener_costos()` reports that date as a conflict and does not delete it.
- Do not run the prune statements in `supabase/migrations/20261107_costos_prune_and_schedule.sql` again: they are
  documentation of a one-time operation.

### Closed cycles (already live)

`public.actualizar_estado_corridas()` runs daily at 11:30 UTC (pg_cron job `actualizar-estado-corridas`). It marks
a cycle `cosechada` when it has been absent from the siembra reports for 60 days or more (measured against the
newest report, so a robot outage never closes anything) and reopens it if it returns. If the robot loads costs
through `corridas` filtered by `estado = 'en_proceso'`, load the siembra report first (the siembra import sets
`en_proceso` again) or do not filter by `estado`. To stop the job:
`select cron.unschedule('actualizar-estado-corridas');`

### Restoring a table from the archive

Each file is a plain CSV with a header. For example, to load one month back into an existing table:

```sql
-- psql
\copy costos_piscina from program 'gzip -dc costos_piscina__2026-06.csv.gz' csv header
```
(or decompress the file first and use the Supabase table editor / `\copy ... from 'file.csv' csv header`).
The tool was tested by restoring its own output into an empty database and comparing a hash of
every row: identical, including text with commas, quotes, newlines and accents.
