import type { NextConfig } from "next";

/**
 * Public origin of the NestJS API. In production web and API live on separate
 * Render hosts, but auth relies on httpOnly cookies scoped to the origin that
 * issues them — so the browser must treat API calls as same-origin. We proxy
 * `/api/*` through Next.js instead of calling the API cross-origin, which keeps
 * cookies, CORS and the OAuth state cookie on one domain.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET;

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
  // Only enabled when API_PROXY_TARGET is set; local dev talks to the API
  // directly on http://localhost:3001 via NEXT_PUBLIC_API_URL.
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [{ source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` }];
  },
};

export default nextConfig;
