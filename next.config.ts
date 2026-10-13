import type { NextConfig } from "next";

// NEXT_OUTPUT=export  → static export to ./out (Render Static Site, GitHub Pages, etc.)
// (unset)             → standalone Node server (default local/web-service flow)
const isStaticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : "standalone",
  images: { unoptimized: true },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
