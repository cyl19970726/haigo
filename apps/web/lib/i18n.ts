export const defaultLocale = 'en';
export const locales = ['en'] as const;

export type Locale = (typeof locales)[number];

export function getTranslation(locale: Locale) {
  switch (locale) {
    case 'en':
    default:
      return { welcome: 'Welcome to Haigo Platform' };
  }
}
