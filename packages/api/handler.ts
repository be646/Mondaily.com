import type { IncomingMessage, ServerResponse } from 'node:http'

function handler(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ ok: true, version: '1.0.0', path: req.url }))
}

module.exports = handler
