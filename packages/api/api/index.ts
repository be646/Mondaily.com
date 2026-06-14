import { handle } from 'hono/vercel'
import app from '../src/app'

export const config = { runtime: 'nodejs20.x', maxDuration: 30 }

export default handle(app)
