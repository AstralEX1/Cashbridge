import { apiError } from '@/lib/api-error'

// Count bytes while reading: Content-Length may be absent or supplied by the caller.
export async function readRequestBody(req: Request, maxBytes: number): Promise<string | Response> {
  const tooLarge = () => apiError(413, 'payload_too_large', 'Request body too large', `At most ${maxBytes} bytes.`)
  if (Number(req.headers.get('content-length')) > maxBytes) return tooLarge()
  const reader = req.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return tooLarge()
      }
      chunks.push(next.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return apiError(400, 'bad_request', 'Could not read request body', 'Send a complete request body.')
  } finally {
    reader.releaseLock()
  }
}
