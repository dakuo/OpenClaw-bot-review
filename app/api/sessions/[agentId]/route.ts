import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    
    // Try multiple session index locations for nanobot
    const candidates = [
      path.join(NANOBOT_HOME, `agents/${agentId}/sessions/sessions.json`),
    ];
    if (agentId === "main") {
      candidates.push(path.join(NANOBOT_HOME, "workspace/sessions/sessions.json"));
    }

    let sessions: Record<string, any> = {};
    for (const sessionsPath of candidates) {
      try {
        const raw = fs.readFileSync(sessionsPath, "utf-8");
        sessions = { ...sessions, ...JSON.parse(raw) };
      } catch {}
    }

    // Also scan JSONL files for metadata-based session discovery
    const sessionsDirs = [
      path.join(NANOBOT_HOME, `agents/${agentId}/sessions`),
    ];
    if (agentId === "main") {
      sessionsDirs.push(path.join(NANOBOT_HOME, "workspace/sessions"));
    }

    for (const sessionsDir of sessionsDirs) {
      try {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
            const firstLine = content.split("\n")[0];
            const meta = JSON.parse(firstLine);
            if (meta._type === "metadata" && meta.key && !sessions[meta.key]) {
              sessions[meta.key] = {
                sessionId: file.replace(".jsonl", ""),
                updatedAt: meta.updated_at ? new Date(meta.updated_at).getTime() : 0,
              };
            }
          } catch {}
        }
      } catch {}
    }

    const list = Object.entries(sessions).map(([key, val]: [string, any]) => {
      // 解析 session 类型
      let type = "unknown";
      let target = "";
      if (key.endsWith(":main")) {
        type = "main";
      } else if (key.includes(":feishu:direct:") || key.includes("feishu:direct:")) {
        type = "feishu-dm";
        target = key.split("feishu:direct:")[1] || "";
      } else if (key.includes(":feishu:group:") || key.includes("feishu:group:")) {
        type = "feishu-group";
        target = key.split("feishu:group:")[1] || "";
      } else if (key.includes(":discord:direct:") || key.includes("discord:direct:")) {
        type = "discord-dm";
        target = key.split("discord:direct:")[1] || "";
      } else if (key.includes(":discord:channel:") || key.includes("discord:channel:")) {
        type = "discord-channel";
        target = key.split("discord:channel:")[1] || "";
      } else if (key.includes(":telegram:direct:") || key.includes("telegram:direct:")) {
        type = "telegram-dm";
        target = key.split("telegram:direct:")[1] || "";
      } else if (key.includes(":telegram:group:") || key.includes("telegram:group:")) {
        type = "telegram-group";
        target = key.split("telegram:group:")[1] || "";
      } else if (key.includes(":whatsapp:direct:") || key.includes("whatsapp:direct:")) {
        type = "whatsapp-dm";
        target = key.split("whatsapp:direct:")[1] || "";
      } else if (key.includes(":whatsapp:group:") || key.includes("whatsapp:group:")) {
        type = "whatsapp-group";
        target = key.split("whatsapp:group:")[1] || "";
      } else if (key.includes(":cron:")) {
        type = "cron";
        target = key.split(":cron:")[1] || "";
      }

      return {
        key,
        type,
        target,
        sessionId: val.sessionId || null,
        updatedAt: val.updatedAt || 0,
        totalTokens: val.totalTokens || 0,
        contextTokens: val.contextTokens || 0,
        systemSent: val.systemSent || false,
      };
    });

    // 按最近活跃排序
    list.sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ agentId, sessions: list });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
