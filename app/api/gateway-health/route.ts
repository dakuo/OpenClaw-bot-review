import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");
const CONFIG_PATH = path.join(NANOBOT_HOME, "config.json");
const DEGRADED_LATENCY_MS = 1500;

export async function GET() {
  const startedAt = Date.now();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    const port = config.gateway?.port || 18790;
    const webCfg = config.gateway?.web || {};
    const webHost = webCfg.host || "127.0.0.1";
    const webToken = webCfg.token || "";

    const url = `http://${webHost}:${port}/api/health`;
    const headers: Record<string, string> = {};
    if (webToken) headers["Authorization"] = `Bearer ${webToken}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const checkedAt = Date.now();
    const responseMs = checkedAt - startedAt;

    if (!resp.ok) {
      return NextResponse.json({
        ok: false,
        error: `HTTP ${resp.status}`,
        status: "down",
        checkedAt,
        responseMs,
      });
    }

    const data = await resp.json().catch(() => null);
    return NextResponse.json({
      ok: true,
      data,
      status: responseMs > DEGRADED_LATENCY_MS ? "degraded" : "healthy",
      checkedAt,
      responseMs,
      webUrl: `http://localhost:${port}/chat${webToken ? '?token=' + encodeURIComponent(webToken) : ''}`,
    });
  } catch (err: any) {
    const checkedAt = Date.now();
    const responseMs = checkedAt - startedAt;
    const msg = err.cause?.code === "ECONNREFUSED"
      ? "Gateway not running"
      : err.name === "AbortError"
        ? "Request timeout"
        : err.message;
    return NextResponse.json({
      ok: false,
      error: msg,
      status: "down",
      checkedAt,
      responseMs,
    });
  }
}
