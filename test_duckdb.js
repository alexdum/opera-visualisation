import duckdb from 'duckdb';
const db = new duckdb.Database(':memory:');
db.all("SELECT DISTINCT parameter FROM read_parquet('https://huggingface.co/datasets/E-OBS/meteogate-observations/resolve/main/data/2026/05/29.parquet') WHERE id='0-20000-0-15197'", function(err, res) {
  if (err) console.error(err);
  else console.log(res);
});
