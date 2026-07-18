import { fetchBypassSSL } from "./src/utils/http";

async function run() {
  // Test yesterday (which should be in the MeteoGate live API window if they publish normally)
  const dateStr = "2026-07-17"; 
  const url = `https://observations.meteogate.eu/collections/observations/area?coords=POLYGON((16%2045,23%2045,23%2049,16%2049,16%2045))&standard_name=air_temperature&datetime=${dateStr}T10:00Z/${dateStr}T10:59Z`;
  
  try {
    console.log("Fetching:", url);
    const raw = await fetchBypassSSL(url, 15000);
    const json = JSON.parse(raw);
    console.log("Total Coverages returned:", json.coverages?.length || 0);
    const hungaryIds = ["0-348-1-13704", "0-348-1-15310", "0-348-1-14707"];
    const found = (json.coverages || []).filter((c: any) => hungaryIds.includes(c["metocean:wigosId"]));
    console.log("Hungary stations found:", found.length);
    if (found.length > 0) {
      console.log("Sample:", found[0]["metocean:wigosId"], found[0].ranges);
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}
run();
