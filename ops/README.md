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

Only after that is it safe to prune old snapshots in Supabase.

### Restoring a table from the archive

Each file is a plain CSV with a header. For example, to load one month back into an existing table:

```sql
-- psql
\copy costos_piscina from program 'gzip -dc costos_piscina__2026-06.csv.gz' csv header
```
(or decompress the file first and use the Supabase table editor / `\copy ... from 'file.csv' csv header`).
The tool was tested by restoring its own output into an empty database and comparing a hash of
every row: identical, including text with commas, quotes, newlines and accents.
