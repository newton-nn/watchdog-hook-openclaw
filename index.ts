import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "watchdog-hook",
  name: "Agent Watchdog Hook",
  description:
    "Injects agent identity into Agent Watchdog MCP calls via before_tool_call hook",

  register(api) {
    api.on("before_tool_call", async (event, ctx) => {
      // Log ALL tool calls to confirm hook fires
      console.log(`[watchdog-hook] FIRED: toolName="${event.toolName}" sessionKey=${ctx?.sessionKey || '(none)'} agentId=${ctx?.agentId || '(none)'}`);

      // Match any agent-watchdog tool call regardless of prefix format
      const name = event.toolName || "";
      const isWatchdogTool =
        name.startsWith("mcp__agent-watchdog__") ||
        name.startsWith("agent-watchdog__") ||
        name.includes("agent-watchdog");

      if (!isWatchdogTool) {
        return;
      }

      const sessionKey = ctx?.sessionKey;
      if (!sessionKey) {
        return;
      }

      // Inject the authoritative session key into tool params.
      // The MCP server extracts agent identity from the session key
      // pattern (agent:$agent:watchdog-worker → second segment).
      // The hook OVERWRITES any value the agent might have set.
      return {
        params: {
          ...event.params,
          _openclaw_session_key: sessionKey,
        },
      };
    }, { priority: 50 });
  },
});
