#!/usr/bin/env python3
"""
Archive the Supabase database to compressed CSV files (meant for a OneDrive folder).

Why: the Free plan has no downloadable backups, and costos_piscina holds ~4M rows of
near-identical daily snapshots. Before old snapshots are pruned from Supabase, a verified
copy of everything must exist outside Supabase.

What it does
  * Connects straight to Postgres (the REST API is blocked while the project is restricted).
  * Reads everything in ONE consistent snapshot (REPEATABLE READ, read-only: it cannot change data).
  * Writes one .csv.gz per table; costos_piscina is split per month.
  * Reads every file back and checks row count (and the sum of `valor`) against the database.
  * Writes manifest.json (rows, bytes, SHA-256 per file). Exit code 0 only if everything matched.

Setup (once, on the NUC):
  py -m pip install "psycopg[binary]"

Usage (PowerShell):
  $env:SUPABASE_DB_URL = "<Session pooler connection string from Supabase > Connect>"
  py archive_costos.py --out "C:\\Users\\YOU\\OneDrive - Lukmar\\Archivo Supabase\\2026-11-06"
  # later, on the synced copy (no database needed):
  py archive_costos.py --verify "C:\\Users\\YOU\\OneDrive - Lukmar\\Archivo Supabase\\2026-11-06"

Notes
  * Use the *Session pooler* string (port 5432). The "direct" host is IPv6-only on the Free plan.
  * The connection string contains the DB password. It is read from the environment and never
    printed or written to disk by this script.
  * The `usuarios` table is skipped on purpose (personal data; Auth users cannot be restored from CSV).
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import shutil
import sys
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

TOOL_VERSION = "1.0"
BIG_TABLE = "costos_piscina"
SKIP_TABLES = {"usuarios"}
MANIFEST = "manifest.json"

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


# ----------------------------------------------------------------- helpers
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_back(path: Path, sum_col: str | None):
    """Return (rows, sum_of_sum_col) by parsing the .csv.gz exactly as a restore would."""
    rows, total = 0, Decimal(0)
    with gzip.open(path, "rb") as gz:
        text = io.TextIOWrapper(gz, encoding="utf-8", newline="")
        reader = csv.reader(text)
        header = next(reader, None)
        if header is None:
            raise ValueError(f"{path.name}: empty file (no header)")
        idx = header.index(sum_col) if sum_col and sum_col in header else None
        for rec in reader:
            rows += 1
            if idx is not None and rec[idx] != "":
                total += Decimal(rec[idx])
    return rows, total


def month_bounds(first_of_month: date):
    y, m = first_of_month.year, first_of_month.month
    nxt = date(y + (m == 12), 1 if m == 12 else m + 1, 1)
    return first_of_month, nxt


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return str(n)


# ----------------------------------------------------------------- export
def export_one(conn, psql, select_sql, path: Path):
    """Stream `select_sql` as CSV into path (gzip). Writes to .part first, then renames."""
    tmp = path.with_name(path.name + ".part")
    stmt = psql.SQL("COPY ({}) TO STDOUT WITH (FORMAT csv, HEADER true)").format(select_sql)
    with open(tmp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=6) as gz:
        with conn.cursor() as cur, cur.copy(stmt) as copy:
            for chunk in copy:
                gz.write(bytes(chunk))
    os.replace(tmp, path)


def cmd_export(args) -> int:
    try:
        import psycopg
        from psycopg import sql as psql
        from psycopg import IsolationLevel
    except ImportError:
        print('Missing dependency. Run:  py -m pip install "psycopg[binary]"')
        return 2

    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        print("Set the SUPABASE_DB_URL environment variable first (Session pooler string).")
        return 2

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()

    # Supabase requires TLS; only force it when the string does not already say otherwise.
    extra = {} if "sslmode=" in url else {"sslmode": "require"}
    conn = psycopg.connect(url, connect_timeout=30, **extra)
    conn.isolation_level = IsolationLevel.REPEATABLE_READ
    conn.read_only = True
    entries, failures = [], []

    with conn:
        conn.execute("SET statement_timeout = 0")
        with conn.cursor() as cur:
            cur.execute(
                "select table_name from information_schema.tables "
                "where table_schema='public' and table_type='BASE TABLE' order by 1"
            )
            tables = [r[0] for r in cur.fetchall() if r[0] not in SKIP_TABLES]
            cur.execute(
                "select table_name from information_schema.columns "
                "where table_schema='public' and column_name='valor'"
            )
            has_valor = {r[0] for r in cur.fetchall()}

            jobs = []  # (table, label, filter_text, select_sql, count_sql)
            for t in tables:
                ident = psql.Identifier("public", t)
                if t == BIG_TABLE:
                    cur.execute(
                        f"select distinct date_trunc('month', fecha_reporte)::date from public.{BIG_TABLE} "
                        "where fecha_reporte is not null order by 1"
                    )
                    for (m,) in cur.fetchall():
                        lo, hi = month_bounds(m)
                        where = psql.SQL("fecha_reporte >= {} and fecha_reporte < {}").format(
                            psql.Literal(lo), psql.Literal(hi))
                        sel = psql.SQL(
                            "select * from {} where {} order by fecha_reporte, corrida_id, producto_codigo"
                        ).format(ident, where)
                        jobs.append((t, f"{t}__{lo:%Y-%m}", f"{lo} <= fecha_reporte < {hi}", sel, where))
                    where = psql.SQL("fecha_reporte is null")
                    jobs.append((t, f"{t}__sin_fecha", "fecha_reporte is null",
                                 psql.SQL("select * from {} where {}").format(ident, where), where))
                else:
                    jobs.append((t, t, "all rows", psql.SQL("select * from {}").format(ident), None))

            print(f"Tables to archive: {len(tables)}   files: {len(jobs)}   output: {out}")
            for i, (t, label, flt, sel, where) in enumerate(jobs, 1):
                path = out / f"{label}.csv.gz"
                # Expected values straight from the database (same snapshot).
                ident = psql.Identifier("public", t)
                agg = psql.SQL("select count(*), coalesce(sum(valor), 0) from {}").format(ident) if t in has_valor \
                    else psql.SQL("select count(*), 0 from {}").format(ident)
                if where is not None:
                    agg = agg + psql.SQL(" where ") + where
                cur.execute(agg)
                db_rows, db_sum = cur.fetchone()
                db_sum = Decimal(db_sum)

                if db_rows == 0 and where is not None:
                    print(f"[{i}/{len(jobs)}] {label}: 0 rows, skipped")
                    continue

                export_one(conn, psql, sel, path)
                rows, total = read_back(path, "valor" if t in has_valor else None)
                ok = (rows == db_rows) and (total == db_sum)
                size = path.stat().st_size
                print(f"[{i}/{len(jobs)}] {label}: db_rows={db_rows} file_rows={rows} "
                      f"{'sum ok' if total == db_sum else 'SUM MISMATCH'} {human(size)} -> {'OK' if ok else 'FAIL'}")
                if not ok:
                    failures.append(label)
                entries.append({
                    "file": path.name, "table": t, "filter": flt, "rows": rows,
                    "sum_valor": str(total) if t in has_valor else None,
                    "db_rows": db_rows, "bytes": size, "sha256": sha256_file(path), "ok": ok,
                })

            # Completeness: every row of every table must be covered by some file.
            for t in tables:
                cur.execute(psql.SQL("select count(*) from {}").format(psql.Identifier("public", t)))
                total_rows = cur.fetchone()[0]
                covered = sum(e["rows"] for e in entries if e["table"] == t)
                if covered != total_rows:
                    print(f"COVERAGE PROBLEM: {t}: table has {total_rows} rows, files cover {covered}")
                    failures.append(f"{t}:coverage")
            cur.execute(f"select max(fecha_reporte), min(fecha_reporte) from public.{BIG_TABLE}")
            max_d, min_d = cur.fetchone()

    manifest = {
        "tool_version": TOOL_VERSION,
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "costos_piscina_fecha_min": str(min_d), "costos_piscina_fecha_max": str(max_d),
        "all_verified": not failures, "files": entries,
    }
    tmp = out / (MANIFEST + ".part")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    os.replace(tmp, out / MANIFEST)

    for extra in (args.also_copy_to or []):
        dest = Path(extra).expanduser()
        dest.mkdir(parents=True, exist_ok=True)
        for e in entries:
            shutil.copy2(out / e["file"], dest / e["file"])
            if sha256_file(dest / e["file"]) != e["sha256"]:
                failures.append(f"copy:{e['file']}")
        shutil.copy2(out / MANIFEST, dest / MANIFEST)
        print(f"Copied and re-hashed into {dest}")

    total_bytes = sum(e["bytes"] for e in entries)
    print(f"\n{len(entries)} files, {human(total_bytes)} total, {time.time() - started:.0f}s")
    if failures:
        print("ARCHIVE NOT VERIFIED. Problems: " + ", ".join(failures))
        return 1
    print("ARCHIVE VERIFIED OK: every file matches the database row counts and sums.")
    print("Next: wait until OneDrive shows this folder as fully synced, then run with --verify on it.")
    return 0


# ----------------------------------------------------------------- verify
def cmd_verify(args) -> int:
    d = Path(args.verify).expanduser()
    mf = d / MANIFEST
    if not mf.exists():
        print(f"No {MANIFEST} in {d}")
        return 2
    manifest = json.loads(mf.read_text(encoding="utf-8"))
    bad = 0
    for e in manifest["files"]:
        p = d / e["file"]
        problems = []
        if not p.exists():
            problems.append("missing")
        else:
            if p.stat().st_size != e["bytes"]:
                problems.append("size differs")
            if sha256_file(p) != e["sha256"]:
                problems.append("sha256 differs")
            else:
                rows, total = read_back(p, "valor" if e["sum_valor"] is not None else None)
                if rows != e["rows"]:
                    problems.append(f"rows {rows} != {e['rows']}")
                if e["sum_valor"] is not None and total != Decimal(e["sum_valor"]):
                    problems.append("sum differs")
        print(f"{e['file']}: {'OK' if not problems else 'FAIL (' + ', '.join(problems) + ')'}")
        bad += bool(problems)
    if bad or not manifest.get("all_verified"):
        print(f"\nVERIFY FAILED ({bad} bad files; export all_verified={manifest.get('all_verified')})")
        return 1
    print(f"\nVERIFY OK: {len(manifest['files'])} files match the manifest "
          f"(snapshot max fecha_reporte {manifest['costos_piscina_fecha_max']}).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="folder to write the archive into (e.g. a OneDrive folder)")
    ap.add_argument("--also-copy-to", nargs="*", help="extra folders to copy the verified archive into")
    ap.add_argument("--verify", help="re-check an existing archive folder against its manifest (no database)")
    args = ap.parse_args()
    if args.verify:
        return cmd_verify(args)
    if not args.out:
        ap.error("--out is required (or use --verify)")
    return cmd_export(args)


if __name__ == "__main__":
    sys.exit(main())
