import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false, // Disabled due to starknet type inference issues in generated files
  sourcemap: true,
  clean: true,
  minify: true,
  target: 'esnext',
});
