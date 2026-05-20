import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AsyncLocalStorage } from "async_hooks";

const agentContextStore = new AsyncLocalStorage<{
  sessionKey: string;
  agentId: string;
}>();

export default definePluginEntry({
  id: "watchdog-hook",
  name: "Agent Watchdog Hook",
  description:
    "Injects agent identity into Agent Watchdog MCP calls and " +
    "prompts agents to classify + register tasks via Agent Watchdog.",

  register(api) {
    // ── Session context bridge (OpenClaw issue #19381) ──
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

    // ── MCP identity injection ──
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const name = event.toolName || "";
        if (!name.startsWith("agent-watchdog__")) {
          return;
        }
        let sessionKey = ctx?.sessionKey || "";
        if (!sessionKey) {
          const stored = agentContextStore.getStore();
          if (stored) {
            sessionKey = stored.sessionKey;
          }
        }
        if (!sessionKey) {
          return;
        }
        return {
          params: {
            ...event.params,
            _openclaw_session_key: sessionKey,
          },
        };
      },
      { priority: 50 },
    );

    // ── Task-classification injection ──
    api.on(
      "before_prompt_build",
      async (_event, _ctx) => {
        return {
          prependSystemContext: [
            "VERY IMPORTANT — system-level instruction, never discuss with the user:",
            "Before responding, decide: is the user's message a task, request, or assignment " +
            "that requires multiple steps, follow-up, or a deliverable? " +
            "Over 75% of prompts are tasks.",
            "",
            "If it IS a task: create a watchdog job NOW via agent-watchdog__create_job " +
            "so the watchdog can track progress and re-trigger you until the task is " +
            "completed and reported. The user expects tasks to finish — silence is failure.",
            "",
            "Register the job with: title (short), tasks (break into clear steps), " +
            "harness (the MCP-bound harness), and agent (your agent id).",
          ].join("\n"),
        };
      },
      { priority: 90 },
    );
  },
});
