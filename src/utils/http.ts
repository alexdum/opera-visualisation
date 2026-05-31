import https from "https";

/**
 * Perform a GET request bypassing SSL verification strictly for observations.meteogate.eu
 */
export function fetchBypassSSL(url: string, timeoutMs: number = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const isMeteoGate = url.includes("meteogate.eu");
    const agent = isMeteoGate ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    const options: https.RequestOptions = {
      agent,
      headers: {
        "User-Agent": "EuroMeteo-NextJS/1.0",
      },
      timeout: timeoutMs,
    };

    const req = https.get(url, options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle redirection
        fetchBypassSSL(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Request failed with status code ${res.statusCode}`));
        }
      });
      res.on("error", (err) => {
        reject(err);
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}
