import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  images: {
    remotePatterns: [new URL("https://cdn.shopify.com/s/files/**")],
  },
};

export default nextConfig;
