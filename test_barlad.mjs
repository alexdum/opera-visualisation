import duckdb from 'duckdb';
const db = new duckdb.Database(':memory:');
const query = `
  SELECT DISTINCT parameter
  FROM read_parquet('https://huggingface.co/datasets/alexdum/meteogate-archive/resolve/main/data/2026/05/29.parquet')
  WHERE id = '0-20000-0-15197'
`;

db.all(query, (err, res) => {
  if (err) console.error("DuckDB error:", err.message);
  else console.log("Parameters for Barlad:", res);
});
