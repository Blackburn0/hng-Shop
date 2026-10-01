import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Google profile photos shown in the header after sign-in.
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
  async rewrites() {
    return [
      { source: "/health", destination: "/api/health" },
      { source: "/ready", destination: "/api/ready" },
    ];
  },
};

export default nextConfig;
