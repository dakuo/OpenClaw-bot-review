import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");
const CONFIG_PATH = path.join(NANOBOT_HOME, "config.json");

function isGatewayRunning(): boolean {
  const { execSync } = require("child_process");
  try {
    const output = execSync("pgrep -f 'nanobot gateway' 2>/dev/null || pgrep -f 'nanobot/cli.*gateway' 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    const port = config.gateway?.port || 18790;
    const host = config.gateway?.host || "0.0.0.0";

    const running = isGatewayRunning();

    if (!running) {
      return NextResponse.json({ ok: false, error: "Gateway not running" });
    }

    const channels: string[] = [];
    const ch = config.channels || {};
    for (const [name, cfg] of Object.entries(ch)) {
      if ((cfg as any).enabled !== false && (cfg as any).token || (cfg as any).botToken || (cfg as any).appId || (cfg as any).clientId) {
        channels.push(name);
      }
    }

    return NextResponse.json({
      ok: true,
      data: { channels, port, host },
      webUrl: `http://localhost:${port}/chat`,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
