module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/cli.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 57,
      functions: 72,
      lines: 69,
      statements: 68,
    },
  },
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  forceExit: true,
};
