/* jest-expo gives Metro-compatible transforms so TS + RN modules resolve the way
 * the app builds them. Hardware-free by definition: anything needing a device or
 * a live backend lives in the manual test matrix, not here.
 *
 * roots includes the workspace packages so their tests run under one config —
 * the protocol codec has no RN dependency but shares the Babel pipeline. */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/../../packages'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  /* @wearwise/legal's tests are Vitest; the dashboard's test script runs them. */
  testPathIgnorePatterns: ['/node_modules/', '/packages/legal/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|zustand|@wearwise/.*))',
  ],
};
