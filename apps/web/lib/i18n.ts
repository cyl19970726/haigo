export const defaultLocale = 'en';
export const locales = ['en', 'zh'] as const;

export type Locale = (typeof locales)[number];

export function getTranslation(locale: Locale) {
  switch (locale) {
    case 'zh':
      return { welcome: '欢迎来到 Haigo 平台' };
    case 'en':
    default:
      return { welcome: 'Welcome to Haigo Platform' };
  }
}
