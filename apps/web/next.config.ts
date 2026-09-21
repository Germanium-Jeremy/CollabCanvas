import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next transpile them.
  transpilePackages: ["@collabcanvas/shared", "@collabcanvas/yjs-utils"],
  // Konva 9's package entry is its Node build (index-node.js), which requires the
  // native 'canvas' package. The browser build doesn't need it — stub it out.
  // (Konva 10+ resolves this upstream; revisit on upgrade.)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
