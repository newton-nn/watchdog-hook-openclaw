# watchdog-hook-openclaw

OpenClaw plugin that bridges agent identity into Agent Watchdog MCP tool calls and prompts agents to classify incoming messages as tasks.

## What it does

### 1. Session context injection (`before_tool_call`)

When an agent calls any `agent-watchdog__*` MCP tool, this plugin injects the agent's current session key into the tool arguments as `_openclaw_session_key`. The Agent Watchdog MCP server uses this to record **who made the request** (the `request_session_key`) — separately from **where the watchdog triggers** (the `session_key`).

This solves OpenClaw issue #19381 where MCP transport `_meta` is not populated with the caller's session identity. Instead of relying on `_meta.sessionKey` (which is empty in the current MCP transport), the plugin uses `before_tool_call` to inject the session key directly into the tool arguments.

### 2. Agent identity bridge (`before_agent_start`)

Captures `ctx.sessionKey` and `ctx.agentId` from the agent start event into `AsyncLocalStorage`. This serves as a fallback when `before_tool_call` doesn't receive the session key from its own context.

### 3. Task-classification prompt (`before_prompt_build`)

Injects a system instruction telling the agent to evaluate whether the user's message is a task requiring multi-step follow-up, and if so, to create a watchdog job via `agent-watchdog__create_job`.

## Session key flow

```
Agent session (e.g. Discord)
  │
  ▼
before_agent_start → stores {sessionKey, agentId}
  │
  ▼
Agent calls agent-watchdog__create_job
  │
  ▼
before_tool_call → injects _openclaw_session_key into args
  │
  ▼
MCP server receives args._openclaw_session_key
  │
  ├─► request_session_key = agent:iconimedia-project-manager:discord:xyz
  │   (who made the request — for auditing)
  │
  └─► session_key = agent:iconimedia-project-manager:watchdog-worker
      (where watchdog triggers — for task processing)
```

## Configuration

In `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "watchdog-hook": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true
        }
      }
    }
  }
}
```

## Build

```bash
npm install
npm run build
```

The built plugin is loaded by the gateway from the project directory configured in `openclaw.json`.
