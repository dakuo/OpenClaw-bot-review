import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const NANOBOT_HOME = process.env.NANOBOT_HOME || path.join(process.env.HOME || "", ".nanobot");

function findNanobotPkg(): string | null {
  const { execSync } = require("child_process");
  const candidates: string[] = [];
  
  // Try multiple Python binaries since the system python3 may not have nanobot
  const pythonBins = ["python3", "python", "python3.13", "python3.12", "python3.11"];
  for (const py of pythonBins) {
    try {
      const pkgPath = execSync(`${py} -c "import nanobot, os; print(os.path.dirname(nanobot.__file__))"`, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (pkgPath) { candidates.push(pkgPath); break; }
    } catch {}
  }
  
  // Also try pip show for editable installs
  for (const pip of ["pip3", "pip"]) {
    try {
      const output = execSync(`${pip} show nanobot-ai 2>/dev/null || ${pip} show nanobot 2>/dev/null`, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
      const locMatch = output.match(/Location:\s*(.+)/);
      if (locMatch) candidates.push(path.join(locMatch[1].trim(), "nanobot"));
      const editMatch = output.match(/Editable project location:\s*(.+)/);
      if (editMatch) candidates.push(path.join(editMatch[1].trim(), "nanobot"));
    } catch {}
  }
  
  // Env var override
  if (process.env.NANOBOT_REPO) {
    candidates.push(path.join(process.env.NANOBOT_REPO, "nanobot"));
  }
  
  // Common git clone / home directory locations
  const home = process.env.HOME || "";
  candidates.push(
    path.join(home, "nanobot/nanobot"),
    path.join(home, "projects/nanobot/nanobot"),
    path.join(home, "code/nanobot/nanobot"),
    path.join(home, ".local/lib/python3.11/site-packages/nanobot"),
    path.join(home, ".local/lib/python3.12/site-packages/nanobot"),
    path.join(home, ".local/lib/python3.13/site-packages/nanobot"),
    "/usr/local/lib/python3.11/site-packages/nanobot",
    "/usr/local/lib/python3.12/site-packages/nanobot",
    "/usr/lib/python3/dist-packages/nanobot",
  );

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "skills"))) return c;
  }
  return null;
}

const NANOBOT_PKG = findNanobotPkg();

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  emoji: string;
  source: string; // "builtin" | "extension" | "custom"
  location: string;
  usedBy: string[]; // agent ids
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!content.startsWith("---")) return result;
  const parts = content.split("---", 3);
  if (parts.length < 3) return result;
  const fm = parts[1];

  const nameMatch = fm.match(/^name:\s*(.+)/m);
  if (nameMatch) result.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

  const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (descMatch) result.description = descMatch[1].trim().replace(/^["']|["']$/g, "");

  const emojiMatch = fm.match(/"emoji":\s*"([^"]+)"/);
  if (emojiMatch) result.emoji = emojiMatch[1];

  return result;
}

function scanSkillsDir(dir: string, source: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  if (!fs.existsSync(dir)) return skills;
  for (const name of fs.readdirSync(dir).sort()) {
    const skillMd = path.join(dir, name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const content = fs.readFileSync(skillMd, "utf-8");
    const fm = parseFrontmatter(content);
    skills.push({
      id: name,
      name: fm.name || name,
      description: fm.description || "",
      emoji: fm.emoji || "🔧",
      source,
      location: skillMd,
      usedBy: [],
    });
  }
  return skills;
}

function getAgentSkillsFromSessions(): Record<string, Set<string>> {
  // Parse skillsSnapshot from session JSONL files
  const result: Record<string, Set<string>> = {};

  // Check agents dir
  const agentsDir = path.join(NANOBOT_HOME, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const agentId of fs.readdirSync(agentsDir)) {
      const sessionsDir = path.join(agentsDir, agentId, "sessions");
      if (!fs.existsSync(sessionsDir)) continue;
      scanSessionsForSkills(sessionsDir, agentId, result);
    }
  }

  // Also check workspace sessions for main agent
  const workspaceSessions = path.join(NANOBOT_HOME, "workspace/sessions");
  if (fs.existsSync(workspaceSessions)) {
    scanSessionsForSkills(workspaceSessions, "main", result);
  }

  return result;
}

function scanSessionsForSkills(sessionsDir: string, agentId: string, result: Record<string, Set<string>>) {
  const jsonlFiles = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith(".jsonl"))
    .sort();
  const skillNames = result[agentId] || new Set<string>();

  // Check the most recent session files for skillsSnapshot
  for (const file of jsonlFiles.slice(-3)) {
    const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
    const idx = content.indexOf("skillsSnapshot");
    if (idx < 0) continue;
    const chunk = content.slice(idx, idx + 5000);
    // Match skill names in escaped JSON: \"name\":\"xxx\" or "name":"xxx"
    const matches = chunk.matchAll(/\\?"name\\?":\s*\\?"([^"\\]+)\\?"/g);
    for (const m of matches) {
      const name = m[1];
      // Filter out tool names and other non-skill entries
      if (!["exec","read","edit","write","process","message","web_search","web_fetch",
            "browser","tts","gateway","memory_search","memory_get","cron","nodes",
            "canvas","session_status","sessions_list","sessions_history","sessions_send",
            "sessions_spawn","agents_list"].includes(name) && name.length > 1) {
        skillNames.add(name);
      }
    }
  }
  if (skillNames.size > 0) {
    result[agentId] = skillNames;
  }
}

export async function GET() {
  try {
    // 1. Scan builtin skills (from nanobot Python package)
    let builtinSkills: SkillInfo[] = [];
    if (NANOBOT_PKG) {
      const builtinDir = path.join(NANOBOT_PKG, "skills");
      builtinSkills = scanSkillsDir(builtinDir, "builtin");
    }

    // 2. Scan extension skills (nanobot may not have extensions, but keep for compat)
    const extSkills: SkillInfo[] = [];
    if (NANOBOT_PKG) {
      const extDir = path.join(NANOBOT_PKG, "extensions");
      if (fs.existsSync(extDir)) {
        for (const ext of fs.readdirSync(extDir)) {
          const skillsDir = path.join(extDir, ext, "skills");
          if (fs.existsSync(skillsDir)) {
            const skills = scanSkillsDir(skillsDir, `extension:${ext}`);
            extSkills.push(...skills);
          }
        }
      }
    }

    // 3. Scan custom skills (~/.nanobot/workspace/skills)
    const customDir = path.join(NANOBOT_HOME, "workspace/skills");
    const customSkills = scanSkillsDir(customDir, "custom");

    const allSkills = [...builtinSkills, ...extSkills, ...customSkills];

    // 4. Map agent usage from session data
    const agentSkills = getAgentSkillsFromSessions();
    for (const skill of allSkills) {
      for (const [agentId, skills] of Object.entries(agentSkills)) {
        if (skills.has(skill.id) || skills.has(skill.name)) {
          skill.usedBy.push(agentId);
        }
      }
    }

    // 5. Get agent info for display — nanobot auto-discovers agents
    const agentMap: Record<string, { name: string; emoji: string }> = {};
    try {
      const agentsDir = path.join(NANOBOT_HOME, "agents");
      const dirs = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && !d.name.startsWith(".")) {
          agentMap[d.name] = { name: d.name, emoji: "🤖" };
        }
      }
    } catch {}
    if (!agentMap["main"]) {
      agentMap["main"] = { name: "main", emoji: "🤖" };
    }

    return NextResponse.json({
      skills: allSkills,
      agents: agentMap,
      total: allSkills.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
