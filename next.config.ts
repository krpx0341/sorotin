import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* local filesystem worker app — disable Cache Components */
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
