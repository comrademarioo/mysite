/** @type {import('next').NextConfig} */
const nextConfig = {
  // Non-negotiable per CLAUDE.md: every page is complete HTML at build time.
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
};

export default nextConfig;
