import http from 'http';

http.get('http://localhost:3000/api/observations/station-details?stationId=0-20000-0-15197&start=2026-04-29&end=2026-05-30', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    // Look for windGust in the response
    const lines = data.split('\n');
    let hasWindGust = false;
    for (const line of lines) {
      if (line.includes('windGust":') && !line.includes('windGust":null')) {
        hasWindGust = true;
        console.log("Found row with windGust:", line.substring(0, 200));
        break;
      }
    }
    console.log("Has windGust:", hasWindGust);
  });
}).on('error', (err) => {
  console.log("Error:", err.message);
});
