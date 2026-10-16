import type { NextConfig } from "next";

// The Hono backend always runs separately; Next is the public front door and proxies to it.
const API_URL = process.env.API_URL || "http://localhost:4021";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/registry/:path*", destination: `${API_URL}/registry/:path*` },
      { source: "/buyer/:path*", destination: `${API_URL}/buyer/:path*` },
      { source: "/sellers/:path*", destination: `${API_URL}/sellers/:path*` },
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/healthz", destination: `${API_URL}/healthz` },
    ];
  },
};

export default nextConfig;
