import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the workspace root so a parent folder with its own lockfile is never picked up.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
