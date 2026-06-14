import { serve } from '@hono/node-server'
import app from './app'

const port = parseInt(process.env.PORT || '8787')
serve({ fetch: app.fetch, port }, () => {
  console.log(`Mondaily API running on port ${port}`)
})
