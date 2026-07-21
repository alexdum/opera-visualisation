import { fetchBypassSSL } from "./src/utils/http";

async function run() {
  const url = `https://observations.meteogate.eu/collections`;
  try {
    const raw = await fetchBypassSSL(url, 15000);
    const json = JSON.parse(raw);
    const collections = json.collections || [];
    for (const c of collections) {
      console.log("Collection ID:", c.id);
      console.log("Collection Title:", c.title);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
