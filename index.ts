import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "watchdog-hook",
  name: "Agent Watchdog Hook",
  description:
    "Injects agent identity into Agent Watchdog MCP calls via before_tool_call hook",

  register(api) {
    api.registerHook("before_tool_call", async (event, ctx) => {
      // Only intercept Agent Watchdog MCP tool calls
      if (!event.toolName.startsWith("mcp__agent-watchdog__")) {
        return;
      }

      const sessionKey = ctx.sessionKey;
      if (!sessionKey) {
        return;
      }

      // Mutate params to inject the authoritative session key.
      // The MCP server will extract the agent identity from the session key
      // pattern (agent:$agent:watchdog-worker → segment 2).
      // The hook OVERWRITES any value the agent might have set, so this
      // is not forgeable by the calling agent.
      return {
        params: {
          ...event.params,
          _openclaw_session_key: sessionKey,
        },
      };
    });
  },
});
