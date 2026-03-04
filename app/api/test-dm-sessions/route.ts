import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");
const CONFIG_PATH = path.join(NANOBOT_HOME, "config.json");

interface DmSessionResult {
  agentId: string;
  platform: string;
  ok: boolean;
  detail?: string;
  error?: string;
  elapsed: number;
}

function getDmUser(agentId: string, platform: string): string | null {
  // Check multiple session locations
  const candidates = [
    path.join(NANOBOT_HOME, `agents/${agentId}/sessions/sessions.json`),
  ];
  if (agentId === "main") {
    candidates.push(path.join(NANOBOT_HOME, "workspace/sessions/sessions.json"));
  }

  let bestId: string | null = null;
  let bestTime = 0;
  const pattern = platform === "feishu"
    ? /(?:^agent:[^:]+:)?feishu:direct:(ou_[a-f0-9]+)$/
    : new RegExp(`(?:^agent:[^:]+:)?${platform}:direct:(.+)$`);

  for (const sessionsPath of candidates) {
    try {
      const raw = fs.readFileSync(sessionsPath, "utf-8");
      const sessions = JSON.parse(raw);
      for (const [key, val] of Object.entries(sessions)) {
        const m = key.match(pattern);
        if (m) {
          const updatedAt = (val as any).updatedAt || 0;
          if (updatedAt > bestTime) {
            bestTime = updatedAt;
            bestId = m[1];
          }
        }
      }
    } catch {}
  }
  return bestId;
}

async function testDmSession(
  agentId: string,
  platform: string,
  sessionKey: string,
  gatewayPort: number,
): Promise<DmSessionResult> {
  const startTime = Date.now();
  try {
    const resp = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nanobot-agent-id": agentId,
        "x-nanobot-session-key": sessionKey,
      },
      body: JSON.stringify({
        model: `nanobot:${agentId}`,
        messages: [{ role: "user", content: "Health check: reply with OK" }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(100000),
    });

    const data = await resp.json();
    const elapsed = Date.now() - startTime;

    if (!resp.ok) {
      return { agentId, platform, ok: false, error: data.error?.message || JSON.stringify(data), elapsed };
    }

    const reply = data.choices?.[0]?.message?.content || "";
    return { agentId, platform, ok: true, detail: reply.slice(0, 200) || "(no reply)", elapsed };
  } catch (err: any) {
    return { agentId, platform, ok: false, error: err.message, elapsed: Date.now() - startTime };
  }
}

export async function POST() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    const gatewayPort = config.gateway?.port || 18790;
    const channels = config.channels || {};

    // nanobot: auto-discover agents
    let agentList: any[] = [];
    try {
      const agentsDir = path.join(NANOBOT_HOME, "agents");
      const dirs = fs.readdirSync(agentsDir, { withFileTypes: true });
      agentList = dirs
        .filter((d: any) => d.isDirectory() && !d.name.startsWith("."))
        .map((d: any) => ({ id: d.name }));
    } catch {}
    if (agentList.length === 0) agentList = [{ id: "main" }];

    const results: DmSessionResult[] = [];
    const platformsToTest = ["feishu", "discord", "telegram", "whatsapp"];

    for (const agent of agentList) {
      const id = agent.id;
      for (const platform of platformsToTest) {
        const ch = channels[platform];
        if (!ch || ch.enabled === false) continue;

        // nanobot: channels bind directly, main agent gets all channels
        if (id !== "main") continue;

        const dmUser = getDmUser(id, platform);
        if (!dmUser) continue;

        const sessionKey = `agent:${id}:${platform}:direct:${dmUser}`;
        const r = await testDmSession(id, platform, sessionKey, gatewayPort);
        results.push(r);
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
