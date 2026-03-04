import fs from "fs";
import path from "path";
import { isGatewayRunning } from "./gateway";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");

export type AgentState = "working" | "online" | "idle" | "offline";

export interface AgentStatus {
  agentId: string;
  state: AgentState;
  lastActive: number | null;
}

export function getSessionsDirs(agentId: string): string[] {
  const dirs = [
    path.join(NANOBOT_HOME, `agents/${agentId}/sessions`),
  ];
  if (agentId === "main") {
    dirs.push(path.join(NANOBOT_HOME, "workspace/sessions"));
  }
  return dirs;
}

export function getAgentState(agentId: string): AgentStatus {
  const now = Date.now();
  let lastActive: number | null = null;
  let lastAssistantTs: number | null = null;

  for (const sessionsDir of getSessionsDirs(agentId)) {
    try {
      const sessionsPath = path.join(sessionsDir, "sessions.json");
      const raw = fs.readFileSync(sessionsPath, "utf-8");
      const sessions = JSON.parse(raw);
      for (const val of Object.values(sessions)) {
        const ts = (val as any).updatedAt || 0;
        if (ts > (lastActive || 0)) lastActive = ts;
      }
    } catch {}

    try {
      const files = fs.readdirSync(sessionsDir)
        .filter(f => f.endsWith(".jsonl") && !f.includes(".deleted."))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10);

      for (const file of files) {
        if (file.mtime > (lastActive || 0)) {
          lastActive = file.mtime;
        }

        const content = fs.readFileSync(path.join(sessionsDir, file.name), "utf-8");
        const lines = content.trim().split("\n");

        try {
          const first = JSON.parse(lines[0]);
          if (first._type === "metadata" && first.updated_at) {
            const ts = new Date(first.updated_at).getTime();
            if (ts > (lastActive || 0)) lastActive = ts;
          }
        } catch {}

        if (now - file.mtime < 5 * 60 * 1000) {
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.role === "assistant" && entry.timestamp) {
                const ts = new Date(entry.timestamp).getTime();
                if (!lastAssistantTs || ts > lastAssistantTs) lastAssistantTs = ts;
                if (ts > (lastActive || 0)) lastActive = ts;
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  let state: AgentState = "offline";
  if (lastActive) {
    const diff = now - lastActive;
    if (lastAssistantTs && now - lastAssistantTs < 3 * 60 * 1000) {
      state = "working";
    } else if (diff < 10 * 60 * 1000) {
      state = "online";
    } else if (diff < 24 * 60 * 60 * 1000) {
      state = "idle";
    }
  }

  if (state !== "offline" && !isGatewayRunning()) {
    state = "offline";
  }

  return { agentId, state, lastActive };
}
