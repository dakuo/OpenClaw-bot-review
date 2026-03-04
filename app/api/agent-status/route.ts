import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isGatewayRunning } from "../utils/gateway";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");

// 状态: working(2分钟内有assistant消息) / online(10分钟内) / idle(24小时内) / offline(超过24小时)
type AgentState = "working" | "online" | "idle" | "offline";

interface AgentStatus {
  agentId: string;
  state: AgentState;
  lastActive: number | null;
}

function getSessionsDirs(agentId: string): string[] {
  const dirs = [
    path.join(NANOBOT_HOME, `agents/${agentId}/sessions`),
  ];
  if (agentId === "main") {
    dirs.push(path.join(NANOBOT_HOME, "workspace/sessions"));
  }
  return dirs;
}

function getAgentState(agentId: string): AgentStatus {
  const now = Date.now();
  let lastActive: number | null = null;
  let lastAssistantTs: number | null = null;

  for (const sessionsDir of getSessionsDirs(agentId)) {
    // nanobot: try sessions.json first, then fall back to JSONL metadata
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
        // Use file mtime as lastActive if we haven't found anything yet
        if (file.mtime > (lastActive || 0)) {
          lastActive = file.mtime;
        }

        // Read JSONL metadata for updated_at
        const content = fs.readFileSync(path.join(sessionsDir, file.name), "utf-8");
        const lines = content.trim().split("\n");

        // Check first line for nanobot metadata with updated_at
        try {
          const first = JSON.parse(lines[0]);
          if (first._type === "metadata" && first.updated_at) {
            const ts = new Date(first.updated_at).getTime();
            if (ts > (lastActive || 0)) lastActive = ts;
          }
        } catch {}

        // Scan recent lines for assistant messages (for "working" detection)
        // Only check files modified in last 5 minutes for "working" state
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

  // If gateway is not running, downgrade "working" or "online" to "idle"
  if ((state === "working" || state === "online") && !isGatewayRunning()) {
    state = "idle";
  }

  return { agentId, state, lastActive };
}

export async function GET() {
  try {
    const agentsDir = path.join(NANOBOT_HOME, "agents");
    let agentIds: string[];
    try {
      agentIds = fs.readdirSync(agentsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith("."))
        .map(d => d.name);
    } catch {
      agentIds = ["main"];
    }

    // Ensure main is included for workspace sessions
    if (!agentIds.includes("main")) {
      agentIds.push("main");
    }

    const statuses = agentIds.map(id => getAgentState(id));
    return NextResponse.json({ statuses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
