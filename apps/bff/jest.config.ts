import type { Config } from 'jest';

const config: Config = {
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testEnvironment: 'node',
  preset: 'ts-jest',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1'
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.spec.json'
    }
  }
};

export default config;
