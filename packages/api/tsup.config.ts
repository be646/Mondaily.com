import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'handler.ts' },
  outDir: 'api',
  format: ['cjs'],
  target: 'node20',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: false,
  noExternal: [/./],
  outExtension: () => ({ js: '.js' }),
  esbuildOptions(options) {
    options.platform = 'node'
  },
})
