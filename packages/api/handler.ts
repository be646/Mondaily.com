import type { IncomingMessage, ServerResponse } from 'node:http'
import app from './src/app'

async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const host = req.headers['host'] || 'localhost'
    const url = new URL(req.url || '/', `https://${host}`)

    const headers = new Headers()
    for (const [key, val] of Object.entries(req.headers)) {
      if (val) headers.set(key, Array.isArray(val) ? val.join(', ') : val)
    }

    const body = ['GET', 'HEAD'].includes(req.method || 'GET')
      ? undefined
      : await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', () => resolve(Buffer.concat(chunks)))
        })

    const webRequest = new Request(url.toString(), {
      method: req.method || 'GET',
      headers,
      body: body?.length ? new Uint8Array(body) : undefined,
    })

    const webResponse = await app.fetch(webRequest)

    res.statusCode = webResponse.status
    // Copy headers, but handle Set-Cookie separately: Headers.forEach folds multiple
    // Set-Cookie headers into one comma-joined value, which silently DROPS all but one
    // cookie (this locked out auth — only the refresh cookie survived, not the access
    // cookie). getSetCookie() returns them as an array; Node emits one header per entry.
    webResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return
      res.setHeader(key, value)
    })
    const setCookies = typeof (webResponse.headers as any).getSetCookie === 'function'
      ? (webResponse.headers as any).getSetCookie() as string[]
      : []
    if (setCookies.length) res.setHeader('set-cookie', setCookies)

    // Stream the body chunk-by-chunk so Server-Sent Events (the /ask/stream
    // endpoint) actually reach the client live instead of being buffered to
    // completion first. Falls back gracefully for normal buffered responses.
    if (webResponse.body) {
      const reader = webResponse.body.getReader()
      // Flush SSE headers immediately so the connection opens before tokens.
      if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) res.write(Buffer.from(value))
      }
      res.end()
    } else {
      res.end()
    }
  } catch (err: any) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: err?.message }))
  }
}

module.exports = handler
