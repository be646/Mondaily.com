import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'api/index.ts' },
  outDir: 'api/dist',
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),
  target: 'node20',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/@mondaily\/.*/],
  esbuildOptions(options) {
    options.platform = 'node'
  },
})
