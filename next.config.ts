import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to all API routes
        source: "/api/:path*",
        headers: [
          // Static CORS headers guaranteed to reach the client.
          // Access-Control-Allow-Origin is set dynamically in middleware.ts
          // (it must echo the exact chrome-extension:// origin — can't be static here).
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
          // Vary tells CDN/browser not to cache responses across different origins
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
