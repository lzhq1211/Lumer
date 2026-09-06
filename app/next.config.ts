import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide Next.js' development indicator (the floating "N" button).
  devIndicators: false,
  serverExternalPackages: ['fs-ext-extra-prebuilt'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
