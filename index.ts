import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AsyncLocalStorage } from "async_hooks";

// In-process store that propagates through the async call chain.
// before_agent_start writes session identity here; before_tool_call reads it.
const agentContextStore = new AsyncLocalStorage<{
  sessionKey: string;
  agentId: string;
}>();

export default definePluginEntry({
  id: "watchdog-hook",
  name: "Agent Watchdog Hook",
  description:
    "Injects agent identity into Agent Watchdog MCP calls via before_tool_call hook." +
    " Uses AsyncLocalStorage to bridge the session-context gap documented in OpenClaw issue #19381.",

  register(api) {
    // Capture agent session context at the start of every agent turn.
    // This runs before any tool calls, so the stored context is available
    // downstream in before_tool_call regardless of MCP transport quirks.
    api.on(
      "before_agent_start",
      async (_event, ctx) => {
        const sessionKey = ctx?.sessionKey || "";
        const agentId = ctx?.agentId || "";
        if (sessionKey) {
          agentContextStore.enterWith({ sessionKey, agentId });
        }
      },
      { priority: 100 },
    );

    // Inject session key into Agent Watchdog MCP tool calls.
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        // Only intercept Agent Watchdog MCP tools.
        // Namespace confirmed: agent-watchdog__<tool>
        const name = event.toolName || "";
        if (!name.startsWith("agent-watchdog__")) {
          return;
        }

        // Prefer ctx directly when OpenClaw provides it (native tools).
        let sessionKey = ctx?.sessionKey || "";
        let agentId = ctx?.agentId || "";

        // Fallback: when ctx is empty (MCP tools via stdio transport),
        // retrieve from AsyncLocalStorage populated by before_agent_start.
        if (!sessionKey) {
          const stored = agentContextStore.getStore();
          if (stored) {
            sessionKey = stored.sessionKey;
            agentId = stored.agentId;
          }
        }

        if (!sessionKey) {
          return;
        }

        // Inject the authoritative session key into tool arguments.
        // The MCP server extracts agent identity from the session key
        // pattern (agent:$agent:watchdog-worker → second segment).
        // This is not forgeable by the calling agent because the hook
        // runs in-process inside the Gateway.
        return {
          params: {
            ...event.params,
            _openclaw_session_key: sessionKey,
          },
        };
      },
      { priority: 50 },
    );
  },
});
