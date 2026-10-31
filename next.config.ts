import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* sidecar for the Tauri shell; `pnpm dev` is unchanged */
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      "./src-tauri/**",
      "./license-server/**",
      "./license-appscript/**",
      "./desktop/**",
      "./deploy/**",
      "./data/**",
      "./dist/**",
      "./src-tauri/target/**",
      "./src-tauri/resources/**",
    ],
  },
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
