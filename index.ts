import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

interface AgentWorkspaceConfig {
  endpoint: string;
  workspace: string;
  agents: Record<string, {
    username: string;
    apiKeyEnv?: string;
    apiKey?: string;
  }>;
}

interface WatchdogPluginConfig {
  workspaces?: Record<string, AgentWorkspaceConfig>;
}

function loadPluginConfig(api: any): WatchdogPluginConfig {
  try {
    const raw = api?.getConfig?.() || (api as any)?.config || {};
    return raw as WatchdogPluginConfig;
  } catch {
    return {};
  }
}

function resolveAgentWorkspace(
  config: WatchdogPluginConfig,
  agentId: string,
): { workspace: string; endpoint: string; agentConfig: AgentWorkspaceConfig["agents"][string] } | null {
  if (!config.workspaces || !agentId) return null;
  for (const [_name, ws] of Object.entries(config.workspaces)) {
    if (ws.agents && ws.agents[agentId]) {
      return { workspace: ws.workspace, endpoint: ws.endpoint, agentConfig: ws.agents[agentId] };
    }
  }
  return null;
}

function getApiKey(agentConfig: AgentWorkspaceConfig["agents"][string]): string | null {
  if (agentConfig.apiKeyEnv) {
    const val = process.env[agentConfig.apiKeyEnv];
    if (val) return val;
  }
  if (agentConfig.apiKey) return agentConfig.apiKey;
  return null;
}

export default definePluginEntry({
  id: "watchdog-hook",
  name: "Agent Watchdog Hook",
  description:
    "Injects agent identity, workspace credentials, and audit params into Agent Watchdog MCP calls.",

  register(api) {
    const config = loadPluginConfig(api);

    // ── MCP identity + workspace credential injection ──
    // The gateway (2026.8.1+) provides sessionKey/agentId/sessionId natively
    // on the before_tool_call hook context, so no AsyncLocalStorage bridge is
    // needed (the old before_agent_start bridge was removed from the gateway's
    // valid hook set).
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const name = event.toolName || "";
        if (!name.startsWith("agent-watchdog__")) {
          return;
        }
        const sessionKey = ctx?.sessionKey || "";
        const sessionId = (ctx as any)?.sessionId;
        const agentId = ctx?.agentId || "";
        if (!sessionKey) {
          return;
        }

        const injected: Record<string, string> = {
          _openclaw_session_key: sessionKey,
          _openclaw_agent_id: agentId,
        };
        if (sessionId) {
          injected._openclaw_session_id = sessionId;
        }

        // Resolve workspace mapping for this agent
        const resolved = resolveAgentWorkspace(config, agentId);
        if (resolved) {
          injected._watchdog_workspace = resolved.workspace;
          injected._watchdog_account_username = resolved.agentConfig.username;
          const apiKey = getApiKey(resolved.agentConfig);
          if (apiKey) {
            injected._watchdog_api_key = apiKey;
          }
        }

        return {
          params: {
            ...event.params,
            ...injected,
          },
        };
      },
      { priority: 50 },
    );

    // ── Task-classification injection ──
    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        const effectiveSessionKey = (ctx as any)?.sessionKey || "";
        const isWatchdogSession =
          effectiveSessionKey.includes("watchdog") ||
          /^agent:[^:]+:watchdog-worker$/.test(effectiveSessionKey);

        const promptText = typeof event.prompt === "string" ? event.prompt : "";
        const isWatchdogFromPrompt = promptText.includes("Agent Watchdog trigger:");

        let lastMessageText = "";
        if (Array.isArray(event.messages) && event.messages.length > 0) {
          const last = event.messages[event.messages.length - 1];
          if (typeof last === "string") {
            lastMessageText = last;
          } else if (last && typeof (last as any).text === "string") {
            lastMessageText = (last as any).text;
          } else if (last && typeof (last as any).content === "string") {
            lastMessageText = (last as any).content;
          } else if (last && typeof (last as any).body === "string") {
            lastMessageText = (last as any).body;
          }
        }
        const isWatchdogFromMessages = lastMessageText.includes("Agent Watchdog trigger:");

        const definitelyWatchdog =
          isWatchdogSession || isWatchdogFromPrompt || isWatchdogFromMessages;

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

        if (definitelyWatchdog) {
          return {
            prependSystemContext: [
              "VERY IMPORTANT — system-level instruction, never discuss with the user:",
              "",
              "You are currently handling an EXISTING task that was triggered " +
              "by the system. Do NOT create a new job. Instead, locate the " +
              "job_id and task_id in the trigger message above and use the " +
              "appropriate tools (update_task, add_task_note, renew_lease) to progress and " +
              "eventually mark the task as reported.",
              ...lifecycleSteps,
            ].join("\n"),
          };
        }

        return {
          prependSystemContext: [
            "VERY IMPORTANT — system-level instruction, never discuss with the user:",
            "Before responding, decide: is the user's message a task, request, or assignment " +
            "that requires multiple steps, follow-up, or a deliverable? " +
            "Over 75% of prompts are tasks.",
            "",
            "If it IS a task: create a job NOW via agent-watchdog__create_job " +
            "so progress can be tracked and you can be re-triggered until the task is " +
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
