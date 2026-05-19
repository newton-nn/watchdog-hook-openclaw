import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "watchdog-hook",
  name: "Agent Watchdog Hook",
  description:
    "Injects agent identity into Agent Watchdog MCP calls via before_tool_call hook",

  register(api) {
    console.log("[watchdog-hook] register() called");
    api.registerHook("before_tool_call", async (event, ctx) => {
      // Log the actual tool name to discover the correct namespace format
      console.log(`[watchdog-hook] before_tool_call: toolName="${event.toolName}" sessionKey=${ctx.sessionKey || '(none)'} agentId=${ctx.agentId || '(none)'}`);
      
      // Match any agent-watchdog tool call regardless of prefix
      const isWatchdogTool =
        event.toolName.startsWith("mcp__agent-watchdog__") ||
        event.toolName.startsWith("agent-watchdog__") ||
        event.toolName.startsWith("mcp__agent-watchdog") ||
        // Also try checking if the tool name contains agent-watchdog
        event.toolName.includes("agent-watchdog");
      
      if (!isWatchdogTool) {
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
    }, { name: "inject-watchdog-session-key" });
  },
});
