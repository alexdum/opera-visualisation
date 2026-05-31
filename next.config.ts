import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["duckdb"],
  // @ts-expect-error - Next.js alpha/beta types might not immediately reflect this new security config
  allowedDevOrigins: ["192.168.0.171", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.quarto.pub https://*.climateexplorer.app https://climateexplorer.app https://*.climateexplorer.org https://climateexplorer.org"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
