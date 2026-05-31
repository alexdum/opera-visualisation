import duckdb from 'duckdb';

const db = new duckdb.Database(':memory:');
const query = `
  SELECT DISTINCT standard_name
  FROM read_parquet('https://huggingface.co/datasets/alexdum/meteogate-archive/resolve/main/data/2026/05/2026-05-21.parquet')
  WHERE station_id = '0-20000-0-15197'
`;

db.all(query, (err, res) => {
  if (err) console.error("DuckDB error:", err.message);
  else console.log("Parameters for Barlad on May 21:", res);
});
