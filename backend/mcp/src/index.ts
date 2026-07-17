#!/usr/bin/env node
import { runStdioServer } from './server.js'

runStdioServer().catch((err) => {
  console.error('FlowDesk MCP server failed:', err)
  process.exit(1)
})
