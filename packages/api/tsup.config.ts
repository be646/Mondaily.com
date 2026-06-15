import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { handler: 'handler.ts', index: 'src/index.ts' },
  outDir: 'api',
  format: ['cjs'],
  target: 'node20',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/./],
  outExtension: () => ({ js: '.js' }),
  esbuildOptions(options) {
    options.platform = 'node'
  },
})
