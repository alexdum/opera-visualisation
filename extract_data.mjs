import duckdb from 'duckdb';
import fs from 'fs';
import path from 'path';

const db = new duckdb.Database(':memory:');

db.all(`
SELECT 
    station_id,
    timestamp,
    CAST(value AS DOUBLE) as temperature
FROM read_parquet('data/parquet_cache/2026/06/*.parquet')
WHERE station_id IN ('0-20000-0-08222', '0-20000-0-10384', '0-20000-0-03969', '0-250-0-07156')
  AND standard_name = 'air_temperature'
  AND CAST(value AS DOUBLE) > -50
`, function(err, res) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  
  // Aggregate to hourly means
  const aggregated = {};
  for (const row of res) {
    const d = new Date(row.timestamp);
    d.setMinutes(0, 0, 0);
    const ts = d.toISOString();
    const key = `${row.station_id}_${ts}`;
    if (!aggregated[key]) {
      aggregated[key] = {
        station_id: row.station_id,
        timestamp: ts,
        sum: 0,
        count: 0
      };
    }
    // E-OBS/Meteogate data might be in Kelvin if very large. 
    // Let's keep it as is, we'll convert in python if needed, or convert here:
    let temp = row.temperature;
    if (temp > 100) temp -= 273.15;
    aggregated[key].sum += temp;
    aggregated[key].count++;
  }
  
  const finalRes = Object.values(aggregated).map(x => ({
    station_id: x.station_id,
    timestamp: x.timestamp,
    temperature: x.sum / x.count
  }));

  finalRes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const outPath = path.resolve('../../2024/climateexplorer/.codex_tmp/temperature_data.json');
  fs.writeFileSync(outPath, JSON.stringify(finalRes, null, 2));
  console.log(`Saved ${finalRes.length} rows to ${outPath}`);
});
