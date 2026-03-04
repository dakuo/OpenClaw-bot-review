import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAgentState } from "../utils/agentState";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");

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

    if (!agentIds.includes("main")) {
      agentIds.push("main");
    }

    const statuses = agentIds.map(id => getAgentState(id));
    return NextResponse.json({ statuses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
