import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next transpile them.
  transpilePackages: ["@collabcanvas/shared", "@collabcanvas/yjs-utils"],
};

export default nextConfig;
