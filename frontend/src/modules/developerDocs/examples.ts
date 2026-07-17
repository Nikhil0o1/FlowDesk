/** Server-side examples — never hardcode real keys. */

export const EXAMPLES = {
  curlAuthMe: (base: string) => `# Unix — export FLOWDESK_API_KEY from Settings → API Keys first
curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/auth/me"

# PowerShell (local shell only — use a secrets manager in production)
# Set-Item Env:FLOWDESK_API_KEY -Value <token-from-settings>
curl.exe -sS -H "Authorization: Bearer $env:FLOWDESK_API_KEY" "${base}/auth/me"`,

  jsAuthMe: (base: string) => `// Node.js (server-side) — do not run this in a browser with a real key
const key = process.env.FLOWDESK_API_KEY
if (!key) throw new Error('FLOWDESK_API_KEY is required')

const res = await fetch('${base}/auth/me', {
  headers: { Authorization: \`Bearer \${key}\` },
})
if (!res.ok) {
  const body = await res.json().catch(() => ({}))
  throw new Error(body?.error?.code || \`HTTP \${res.status}\`)
}
console.log(await res.json())`,

  pyAuthMe: (base: string) => `import os
import requests

key = os.environ["FLOWDESK_API_KEY"]
res = requests.get(
    "${base}/auth/me",
    headers={"Authorization": f"Bearer {key}"},
    timeout=30,
)
res.raise_for_status()
print(res.json())`,

  curlListOrgs: (base: string) => `curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/organizations"`,

  jsListOrgs: (base: string) => `const res = await fetch('${base}/organizations', {
  headers: { Authorization: \`Bearer \${process.env.FLOWDESK_API_KEY}\` },
})
if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
console.log(await res.json())`,

  pyListOrgs: (base: string) => `import os, requests
r = requests.get(
    "${base}/organizations",
    headers={"Authorization": f"Bearer {os.environ['FLOWDESK_API_KEY']}"},
    timeout=30,
)
r.raise_for_status()
print(r.json())`,

  curlListProjects: (base: string) => `curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/workspaces/{workspace_id}/projects"`,

  curlListTasks: (base: string) => `curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/me/tasks?relation=assigned"`,

  curlCreateTask: (base: string) => `curl -sS -X POST \\
  -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Example task"}' \\
  "${base}/projects/{project_id}/tasks"`,

  curlListComments: (base: string) => `curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/tasks/{task_id}/comments"`,

  curlAddComment: (base: string) => `curl -sS -X POST \\
  -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"body":"Hello from the API"}' \\
  "${base}/tasks/{task_id}/comments"`,

  curlSearch: (base: string) => `curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/search?q=roadmap&limit=10"`,

  curlLogTime: (base: string) => `curl -sS -X POST \\
  -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"duration_minutes":30,"note":"API work"}' \\
  "${base}/tasks/{task_id}/time-entries"`,

  curlTimer: (base: string) => `# Start
curl -sS -X POST -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/tasks/{task_id}/timer/start"

# Current
curl -sS -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/timer/current"

# Stop
curl -sS -X POST -H "Authorization: Bearer $FLOWDESK_API_KEY" \\
  "${base}/timer/stop"`,

  backoffJs: () => `async function fetchWithBackoff(url, options, { maxAttempts = 5 } = {}) {
  let delay = 500
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, options)
    if (res.status !== 429) return res
    const retryAfter = Number(res.headers.get('Retry-After') || 0)
    const jitter = Math.random() * 200
    const waitMs = Math.max(retryAfter * 1000, delay) + jitter
    await new Promise((r) => setTimeout(r, waitMs))
    delay = Math.min(delay * 2, 8000)
  }
  throw new Error('rate_limited')
}`,

  jsVerifyWebhook: () => `import crypto from 'node:crypto'

export function verifyFlowDeskWebhook(rawBody, signatureHeader, timestampHeader, secret) {
  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts)) throw new Error('missing timestamp')
  if (Math.abs(Date.now() / 1000 - ts) > 300) throw new Error('timestamp outside replay window')

  const signed = \`\${ts}.\${rawBody}\`
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')
  const parts = String(signatureHeader || '').split(',')
  const candidates = parts
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3))

  const ok = candidates.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    } catch {
      return false
    }
  })
  if (!ok) throw new Error('invalid signature')
}`,

  pyVerifyWebhook: () => `import hashlib
import hmac
import time

def verify_flowdesk_webhook(raw_body: bytes, signature_header: str, timestamp_header: str, secret: str) -> None:
    ts = int(timestamp_header)
    if abs(time.time() - ts) > 300:
        raise ValueError("timestamp outside replay window")
    signed = f"{ts}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    candidates = [
        p.strip()[3:]
        for p in (signature_header or "").split(",")
        if p.strip().startswith("v1=")
    ]
    if not any(hmac.compare_digest(sig, expected) for sig in candidates):
        raise ValueError("invalid signature")
}`,

  jsIntegrationWs: (wsBase: string) => `// Node.js — ws package; keep the API key server-side only
import WebSocket from 'ws'

const key = process.env.FLOWDESK_API_KEY
if (!key) throw new Error('FLOWDESK_API_KEY is required')

const socket = new WebSocket('${wsBase}/integrations/ws', {
  headers: { Authorization: \`Bearer \${key}\` },
})

socket.on('message', (data) => {
  const msg = JSON.parse(String(data))
  console.log(msg.type, msg.payload)
})

socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'ping' }))
  // Optional refine:
  // socket.send(JSON.stringify({ type: 'subscribe', resource: 'project', id: '<project-uuid>' }))
  setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), 30000)
})`,

  pyIntegrationWs: (wsBase: string) => `# pip install websocket-client
import json
import os
import threading
import time
import websocket

key = os.environ["FLOWDESK_API_KEY"]

def on_message(_ws, message):
    print(json.loads(message))

def on_open(ws):
    ws.send(json.dumps({"type": "ping"}))
    def heartbeat():
        while True:
            time.sleep(30)
            ws.send(json.dumps({"type": "ping"}))
    threading.Thread(target=heartbeat, daemon=True).start()

ws = websocket.WebSocketApp(
    "${wsBase}/integrations/ws",
    header=[f"Authorization: Bearer {key}"],
    on_open=on_open,
    on_message=on_message,
)
ws.run_forever()`,
}
