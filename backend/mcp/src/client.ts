import { loadConfig } from './config.js'

export class FlowDeskApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown = undefined) {
    super(message)
    this.name = 'FlowDeskApiError'
    this.status = status
    this.body = body
  }
}

function formatDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Request failed'
  const record = body as Record<string, unknown>
  if (typeof record.detail === 'string') return record.detail
  if (Array.isArray(record.detail)) {
    return record.detail
      .map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join('; ')
  }
  return JSON.stringify(body)
}

export class FlowDeskClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl?: string, token?: string) {
    if (baseUrl !== undefined && token !== undefined) {
      this.baseUrl = baseUrl
      this.token = token
      return
    }
    const cfg = loadConfig()
    this.baseUrl = baseUrl ?? cfg.apiUrl
    this.token = token ?? cfg.accessToken
  }

  async request<T>(method: string, path: string, options?: { query?: Record<string, string | number | boolean | undefined>; body?: unknown }): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`)
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
    }
    let body: string | undefined
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const res = await fetch(url, { method, headers, body })
    const text = await res.text()
    let parsed: unknown = undefined
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    if (!res.ok) {
      throw new FlowDeskApiError(res.status, formatDetail(parsed), parsed)
    }
    return parsed as T
  }

  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>('GET', path, { query })
  }

  post<T>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>('POST', path, { body, query })
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body })
  }

  delete<T>(path: string) {
    return this.request<T>('DELETE', path)
  }
}

export function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  }
}

export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  }
}
