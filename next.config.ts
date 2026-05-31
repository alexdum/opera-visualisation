import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["duckdb"],
  allowedDevOrigins: ["192.168.0.171", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.huggingface.co https://huggingface.co https://*.quarto.pub https://*.climateexplorer.app https://climateexplorer.app https://*.climateexplorer.org https://climateexplorer.org"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
