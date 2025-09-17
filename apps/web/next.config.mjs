/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true
  },
  i18n: {
    locales: ['en', 'zh'],
    defaultLocale: 'en'
  }
};

export default nextConfig;
