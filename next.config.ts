import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components / PPR are off on purpose: every app page is per-user and
  // dynamic (auth cookies), and the simpler request-time rendering model is
  // all this product needs.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
