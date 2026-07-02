import fs from 'fs';
import https from 'https';

const stations = [
  '0-250-0-07156', 
  '0-20000-0-08222', 
  '0-20000-0-10384', 
  '0-20000-0-11035', 
  '0-20000-0-12375', 
  '0-348-1-44527'
];

const startIso = '2026-06-27T00:00:00Z';
const endIso = '2026-06-30T23:59:59Z';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function run() {
  const file = 'tmin_extracted_capitals_2026.json';
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const st of stations) {
    const url = `https://observations.meteogate.eu/collections/observations/locations/${st}?datetime=${startIso}/${endIso}&f=CoverageJSON`;
    console.log(`Fetching live data for ${st}...`);
    try {
      const json = await fetchUrl(url);
      const coverages = json.type === "Coverage" ? [json] : (json.coverages || []);
      
      const dayMins = {};
      
      for (const cov of coverages) {
        const tValues = cov.domain?.axes?.t?.values || [];
        const ranges = cov.ranges || {};
        
        // Find air_temperature key
        let tempKey = Object.keys(ranges).find(k => k.includes('air_temperature') && k.includes('PT0S'));
        if (!tempKey) tempKey = Object.keys(ranges).find(k => k.includes('air_temperature'));
        
        if (tempKey && tValues.length > 0) {
          const vals = ranges[tempKey].values || [];
          for (let i = 0; i < tValues.length; i++) {
            let val = vals[i];
            if (val === null || val === undefined) continue;
            if (val > 100) val -= 273.15; // Kelvin to Celsius
            if (val < -50) continue; // invalid
            
            const dateStr = tValues[i].substring(0, 10);
            if (!dayMins[dateStr] || val < dayMins[dateStr]) {
              dayMins[dateStr] = val;
            }
          }
        }
      }
      
      // Append to data
      if (!data[st]) data[st] = [];
      for (const [dStr, minVal] of Object.entries(dayMins)) {
        // Find if exists
        const dt = new Date(`${dStr}T21:00:00Z`).toISOString(); // format used in the json
        const idx = data[st].findIndex(x => x.date.startsWith(dStr));
        if (idx >= 0) {
          // Update if the live min is lower, but normally we just add new days
          data[st][idx] = { date: dt, tmin: minVal };
        } else {
          data[st].push({ date: dt, tmin: minVal });
        }
      }
      
      data[st].sort((a, b) => new Date(a.date) - new Date(b.date));
      console.log(`Updated ${st} with live data.`);
    } catch (err) {
      console.error(`Error for ${st}:`, err.message);
    }
  }
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log("Saved updated Tmin data.");
}

run();
