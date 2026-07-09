import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@droploop/schemas", "@droploop/ui"]
};

export default nextConfig;
