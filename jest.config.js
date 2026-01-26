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
      branches: 50,
      functions: 65,
      lines: 64,
      statements: 63,
    },
  },
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  forceExit: true,
};
