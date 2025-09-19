/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true
  },
  i18n: {
    locales: ['en'],
    defaultLocale: 'en',
    localeDetection: false
  }
};

export default nextConfig;
