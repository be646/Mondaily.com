import { execSync } from 'node:child_process'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'

// 1. Bundle with tsup
execSync('npx tsup', { stdio: 'inherit' })

// 2. Create Vercel Build Output API structure
const funcDir = '.vercel/output/functions/api/index.func'
mkdirSync(funcDir, { recursive: true })

// 3. Copy bundle as the function entry point
copyFileSync('api/handler.js', `${funcDir}/index.js`)

// 4. Function config
writeFileSync(`${funcDir}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.js',
  launcherType: 'Nodejs',
}))

// 5. Global output config with rewrites
writeFileSync('.vercel/output/config.json', JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', dest: '/api/index' }
  ]
}))

console.log('Build Output API structure created')
