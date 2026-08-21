import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: [new URL("https://cdn.shopify.com/s/files/**")],
  },
};

export default nextConfig;
