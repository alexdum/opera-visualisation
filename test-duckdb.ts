import duckdb from "duckdb";
const db = new duckdb.Database(":memory:");

db.all(`
  SELECT standard_name, max(timestamp) as last_obs
  FROM read_parquet('/Users/alexandrudumitrescu/Documents/clima/2026/eurometeo/data/parquet_cache/*/*/*.parquet')
  WHERE station_id IN ('0-348-1-13704', '0-348-1-15310', '0-348-1-14707', '0-348-0-12982')
  GROUP BY standard_name
`, (err, res) => {
  if (err) console.error(err);
  else console.log("Last observations for Hungary:", res);
});
