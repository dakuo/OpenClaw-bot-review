import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isGatewayRunning } from "../utils/gateway";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");
const CONFIG_PATH = path.join(NANOBOT_HOME, "config.json");

export async function GET() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    const port = config.gateway?.port || 18790;
    const webCfg = config.gateway?.web || {};
    const webEnabled = webCfg.enabled !== false;
    const webHost = webCfg.host || "127.0.0.1";
    const webToken = webCfg.token || "";

    const running = isGatewayRunning();
    if (!running) {
      return NextResponse.json({ ok: false, error: "Gateway not running" });
    }

    let httpOk = false;
    if (webEnabled) {
      try {
        const resp = await fetch(`http://${webHost}:${port}/api/health`, {
          signal: AbortSignal.timeout(3000),
        });
        httpOk = resp.ok;
      } catch {}
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
      data: { channels, port, host: webHost, httpOk },
      webUrl: httpOk ? `http://localhost:${port}/chat?token=${encodeURIComponent(webToken)}` : null,
      webToken: httpOk ? webToken : null,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
