# Stage 5 — Manual Plugin Test Procedure

These steps verify the updated OpenClaw watchdog plugin works end-to-end.

## Prerequisites

- Agent Watchdog HTTP MCP server is running (e.g. on `http://localhost:1997` or a public endpoint).
- Two OpenClaw agents exist in the same gateway with different workspace credentials.
- Plugin is installed in OpenClaw's plugin path.

## 1. Plugin Config

In your OpenClaw config (e.g. `~/.openclaw/openclaw.json`), add the plugin config:

```json
{
  "plugins": {
    "watchdog-hook": {
      "workspaces": {
        "default": {
          "endpoint": "http://localhost:1997",
          "workspace": "ws_default",
          "agents": {
            "newton-exposed": {
              "username": "newton-exposed",
              "apiKeyEnv": "WATCHDOG_NEWTON_KEY"
            }
          }
        },
        "iconimedia": {
          "endpoint": "http://localhost:1997",
          "workspace": "ws_iconimedia",
          "agents": {
            "iconimedia-graphics-designer": {
              "username": "iconimedia-gd",
              "apiKeyEnv": "WATCHDOG_ICONIMEDIA_KEY"
            }
          }
        }
      }
    }
  }
}
```

Set the env keys in your shell or OpenClaw environment:

```bash
export WATCHDOG_NEWTON_KEY="tk_newton_..."
export WATCHDOG_ICONIMEDIA_KEY="tk_iconimedia_..."
```

## 2. Start an Agent Session

Trigger or chat with an agent that has a mapped workspace. The plugin will:

- Capture `sessionKey`, `agentId`, `sessionId` in `AsyncLocalStorage` on `before_agent_start`.
- On every `agent-watchdog__*` tool call, inject:
  - `_openclaw_session_key` — session key for audit
  - `_openclaw_session_id` — session ID for audit
  - `_openclaw_agent_id` — agent ID for audit
  - `_watchdog_workspace` — workspace slug from config
  - `_watchdog_account_username` — account username from config
  - `_watchdog_api_key` — API key from env or literal config

## 3. Verify Audit Trail

Check the HTTP MCP server logs. Every tool call should show the resolved workspace and account. If the MCP transport is stdio-bridged, the server falls back to reading `_watchdog_api_key` and `_watchdog_workspace` from the POST body params.

## 4. Isolation Check

1. Chat with `newton-exposed` → create a job.
2. Chat with `iconimedia-graphics-designer` → create a job.
3. Verify via dashboard or direct API that the two jobs land in **different workspaces** (`ws_default` vs `ws_iconimedia`) and are **not visible** to each other.

## 5. Missing Mapping

If an agent is NOT in any workspace config, the plugin will still inject `_openclaw_session_key` and `_openclaw_agent_id`, but **will NOT** inject `_watchdog_workspace`, `_watchdog_account_username`, or `_watchdog_api_key`. The HTTP MCP server will reject the call with:

```json
{"error": "X-Agent-Watchdog-Workspace header or _watchdog_workspace param required"}
```

This proves missing mapping produces an explicit error.

## 6. Missing API Key

If `apiKeyEnv` points to an unset environment variable and no literal `apiKey` is configured, the plugin will skip injecting `_watchdog_api_key`. The server will reject with:

```json
{"error": "Unauthorized: Bearer token required"}
```
