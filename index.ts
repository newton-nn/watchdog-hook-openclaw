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
            "Register the job with: title (short), tasks (break into clear steps). " +
            "Do NOT pass harness or agent — those are set automatically by the MCP server. " +
            "Call agent-watchdog__create_job with only title and tasks.",
            "",
            "═══════════════════════════════════════════════════════════════════",
            "MANDATORY TASK LIFECYCLE — FAILURE TO FOLLOW WILL RETRIGGER TASKS:",
            "═══════════════════════════════════════════════════════════════════",
            "  1. START work → call agent-watchdog__update_task with status='running'",
            "  2. WORKING → call agent-watchdog__renew_lease every ~5 minutes while working",
            "  3. COMPLETE work → call agent-watchdog__update_task with status='completed'",
            "  4. REPORT results to user → send your reply/message to the user",
            "  5. MARK REPORTED → call agent-watchdog__update_task with status='reported'",
            "     ↑ THIS IS THE MOST FORGOTTEN STEP. DO IT IMMEDIATELY AFTER REPORTING.",
            "     If you skip this step, the watchdog will re-trigger the task AGAIN.",
            "",
            "  IF YOU FAIL OR HIT A BLOCKER:",
            "    • Call agent-watchdog__update_task with status='running' (keeps it active)",
            "    • Set last_error to a descriptive message so the user knows what went wrong",
            "    • Call agent-watchdog__add_task_note with details about the blocker",
            "",
            "  REMEMBER: completed ≠ reported. The task is ONLY done when status='reported'.",
          ].join("\n"),
        };
      },
      { priority: 90 },
    );
  },
});
