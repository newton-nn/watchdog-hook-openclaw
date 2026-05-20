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
      async (event, _ctx) => {
        // Detect whether this turn is a watchdog-triggered resume (the agent
        // is being woken to continue an EXISTING job).  In that case we must
        // NOT tell it to create a new job — doing so causes infinite recursive
        // job creation where each trigger spawns a fresh job instead of updating
        // the original task.
        const messageText = (event as any)?.message || (event as any)?.text || "";
        const isWatchdogTrigger =
          typeof messageText === "string" &&
          messageText.includes("Agent Watchdog trigger:");

        // Common lifecycle steps used in both branches.
        const lifecycleSteps = [
          "",
          "═══════════════════════════════════════════════════════════════════",
          "MANDATORY TASK LIFECYCLE — FAILURE TO FOLLOW WILL RETRIGGER TASKS:",
          "═══════════════════════════════════════════════════════════════════",
          "  1. START work → call agent-watchdog__update_task with status='running'",
          "  2. WORKING → call agent-watchdog__renew_lease every ~5 minutes while working",
          "  3. COMPLETE work → call agent-watchdog__update_task with status='completed'",
          "  4. REPORT results to user → send your reply/message to the user",
          "  5. MARK REPORTED → call agent-watchdog__update_task with status='reported'",
          "",
          "  ⚠️ STEP 5 IS THE MOST CRITICAL AND MOST FORGOTTEN STEP. ⚠️",
          "  ⚠️ completed ≠ reported. If you skip step 5, the watchdog will RE-TRIGGER this task again. ⚠️",
          "  ⚠️ ALWAYS call agent-watchdog__update_task with status='reported' IMMEDIATELY after your final reply to the user. ⚠️",
          "",
          "  If you fail or hit a blocker:",
          "    • Call agent-watchdog__update_task with last_error='<descriptive error>' so the user knows what went wrong",
          "    • Call agent-watchdog__add_task_note with details about the blocker",
          "",
          "  REMEMBER: The task is ONLY done when status='reported'. completed alone means NOTHING to the watchdog.",
        ];

        if (isWatchdogTrigger) {
          // The agent is resuming an existing watchdog task.
          // Do NOT tell it to create a new job — work on the existing one.
          return {
            prependSystemContext: [
              "VERY IMPORTANT — system-level instruction, never discuss with the user:",
              "",
              "You are currently handling an EXISTING Agent Watchdog task that was triggered " +
              "by the watchdog daemon. Do NOT create a new job. Instead, locate the " +
              "job_id and task_id in the trigger message above and use the Agent Watchdog " +
              "MCP tools (update_task, add_task_note, renew_lease) to progress and " +
              "eventually mark the task as reported.",
              ...lifecycleSteps,
            ].join("\n"),
          };
        }

        // Normal conversation: prompt the agent to create a new job for new tasks.
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
            ...lifecycleSteps,
          ].join("\n"),
        };
      },
      { priority: 90 },
    );
  },
});
