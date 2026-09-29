import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'v2/index': 'src/v2/index.ts', 'v2/settlement/index': 'src/v2/settlement/index.ts', 'v2/commerceIndex': 'src/v2/commerceIndex.ts' },
  format: ['esm'],
  dts: false, // Disabled due to starknet type inference issues in generated files
  sourcemap: true,
  clean: true,
  minify: true,
  target: 'esnext',
});
