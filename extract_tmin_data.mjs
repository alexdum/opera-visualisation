import duckdb from 'duckdb';
import fs from 'fs';

const db = new duckdb.Database(':memory:');

// WIGOS IDs: Paris, Madrid, Berlin, Vienna
const query = `
    SELECT 
        station_id,
        date_trunc('day', timestamp) as date,
        MIN(value) as tmin
    FROM read_parquet('data/parquet_cache/2026/06/*.parquet')
    WHERE standard_name = 'air_temperature' 
      AND value > -50
      AND station_id IN ('0-250-0-07156', '0-20000-0-08222', '0-20000-0-10384', '0-20000-0-11035', '0-20000-0-12375', '0-348-1-44527')
    GROUP BY station_id, date_trunc('day', timestamp)
    ORDER BY station_id, date
`;

db.all(query, (err, res) => {
    if (err) {
        console.error(err);
        return;
    }
    
    // Group by station
    const resultsByStation = {};
    for (const row of res) {
        if (!resultsByStation[row.station_id]) {
            resultsByStation[row.station_id] = [];
        }
        resultsByStation[row.station_id].push({
            date: row.date.toISOString(),
            tmin: row.tmin
        });
    }

    fs.writeFileSync('tmin_extracted_capitals_2026.json', JSON.stringify(resultsByStation, null, 2));
    console.log("Extracted Tmin data saved to tmin_extracted_capitals_2026.json");
});
