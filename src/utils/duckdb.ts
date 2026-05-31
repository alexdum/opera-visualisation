import duckdb from "duckdb";
import fs from "fs";
import path from "path";
import https from "https";

const db = new duckdb.Database(":memory:");

// Use /tmp for cache in production (Docker containers have read-only /app)
const PARQUET_CACHE_DIR = process.env.NODE_ENV === "production"
  ? path.join("/tmp", "parquet_cache")
  : path.join(process.cwd(), "data", "parquet_cache");

// Ensure cache directory exists
fs.mkdirSync(PARQUET_CACHE_DIR, { recursive: true });

/**
 * Run a SQL query against DuckDB and return rows.
 * Does NOT require httpfs – used for querying local parquet files.
 */
export function queryDuckDB(sql: string): Promise<any[]> {
  return new Promise<any[]>((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Returns the local cache path for a given date string (YYYY-MM-DD).
 */
function getCachePath(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  return path.join(PARQUET_CACHE_DIR, year, month, `${dateStr}.parquet`);
}

/**
 * Downloads a remote URL to a local file path using Node.js https.
 * Follows redirects (Hugging Face uses 302 to CDN).
 * Returns true on success, false on failure.
 */
function downloadFile(
  url: string,
  destPath: string,
  maxRedirects = 5
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (maxRedirects <= 0) {
      resolve(false);
      return;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const tmpPath = destPath + ".tmp";

    const req = https.get(
      url,
      {
        headers: { "User-Agent": "EuroMeteo-NextJS/1.0" },
        timeout: 60000,
      },
      (res) => {
        // Follow redirects (302, 301, 307, 308)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume(); // drain the response
          downloadFile(res.headers.location, destPath, maxRedirects - 1).then(
            resolve
          );
          return;
        }

        if (!res.statusCode || res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }

        const fileStream = fs.createWriteStream(tmpPath);
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          try {
            fs.renameSync(tmpPath, destPath);
            resolve(true);
          } catch {
            resolve(false);
          }
        });
        fileStream.on("error", () => {
          fileStream.close();
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
          resolve(false);
        });
      }
    );

    req.on("error", () => {
      resolve(false);
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Ensures a parquet file for a given date is available locally.
 * Downloads from Hugging Face if not already cached.
 * Returns the local path if available, or null if download failed.
 */
export async function ensureParquetCached(
  dateStr: string
): Promise<string | null> {
  const localPath = getCachePath(dateStr);

  // Already cached?
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  const [year, month] = dateStr.split("-");
  const url = `https://huggingface.co/datasets/alexdum/meteogate-archive/resolve/main/data/${year}/${month}/${dateStr}.parquet`;

  const ok = await downloadFile(url, localPath);
  return ok ? localPath : null;
}

/**
 * Downloads and queries parquet files for a batch of dates.
 * Returns rows from all successfully cached files for the given station.
 */
export async function queryArchiveBatch(
  dateStrs: string[],
  stationId: string
): Promise<any[]> {
  // Download all files in this batch concurrently (limited concurrency)
  const MAX_CONCURRENT = 4;
  const localPaths: string[] = [];

  for (let i = 0; i < dateStrs.length; i += MAX_CONCURRENT) {
    const chunk = dateStrs.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(chunk.map((d) => ensureParquetCached(d)));
    for (const p of results) {
      if (p) localPaths.push(p);
    }
  }

  if (localPaths.length === 0) {
    return [];
  }

  // Normalize paths for DuckDB (forward slashes)
  const normalizedPaths = localPaths.map((p) =>
    p.replace(/\\/g, "/")
  );

  const pathsList = normalizedPaths.map((p) => `'${p}'`).join(", ");
  const sql = `
    SELECT
      timestamp AS datetime,
      standard_name AS paramName,
      value
    FROM read_parquet([${pathsList}])
    WHERE station_id = '${stationId}'
  `;

  return queryDuckDB(sql);
}
