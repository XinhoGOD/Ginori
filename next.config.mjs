/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@duckdb/node-api'],
  outputFileTracingRoot: new URL('.', import.meta.url).pathname
};

export default nextConfig;
