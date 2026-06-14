import type { IncomingMessage, ServerResponse } from 'node:http'
import app from '../src/app'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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
  webResponse.headers.forEach((value, key) => res.setHeader(key, value))

  const responseBody = await webResponse.arrayBuffer()
  res.end(Buffer.from(responseBody))
}
