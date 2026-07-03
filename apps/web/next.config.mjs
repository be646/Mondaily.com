/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the shared TS pricing catalog (workspace package) so the marketing site can import
  // the single source of truth for plans/credits without duplicating prices.
  transpilePackages: ["@mondaily/shared"],
};

export default nextConfig;
