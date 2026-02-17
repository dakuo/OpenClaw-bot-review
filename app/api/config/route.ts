import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 配置文件路径：优先使用 OPENCLAW_HOME 环境变量，否则默认 ~/.openclaw
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || "", ".openclaw");
const CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");
const OPENCLAW_DIR = OPENCLAW_HOME;

// 从 IDENTITY.md 读取机器人名字
function readIdentityName(agentId: string, agentDir?: string, workspace?: string): string | null {
  const candidates = [
    agentDir ? path.join(agentDir, "IDENTITY.md") : null,
    workspace ? path.join(workspace, "IDENTITY.md") : null,
    path.join(OPENCLAW_DIR, `agents/${agentId}/agent/IDENTITY.md`),
    path.join(OPENCLAW_DIR, `workspace-${agentId}/IDENTITY.md`),
    // 只有 main agent 才 fallback 到默认 workspace
    agentId === "main" ? path.join(OPENCLAW_DIR, `workspace/IDENTITY.md`) : null,
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      const content = fs.readFileSync(p, "utf-8");
      const match = content.match(/\*\*Name:\*\*\s*(.+)/);
      if (match) {
        const name = match[1].trim();
        if (name && !name.startsWith("_") && !name.startsWith("(")) return name;
      }
    } catch {}
  }
  return null;
}

export async function GET() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);

    // 提取 agents 信息
    const defaults = config.agents?.defaults || {};
    const defaultModel = typeof defaults.model === "string"
      ? defaults.model
      : defaults.model?.primary || "unknown";
    const fallbacks = typeof defaults.model === "object"
      ? defaults.model?.fallbacks || []
      : [];

    const agentList = config.agents?.list || [];
    const bindings = config.bindings || [];
    const channels = config.channels || {};
    const feishuAccounts = channels.feishu?.accounts || {};

    // 构建 agent 详情
    const agents = agentList.map((agent: any) => {
      const id = agent.id;
      const identityName = readIdentityName(id, agent.agentDir, agent.workspace);
      const name = identityName || agent.name || id;
      const emoji = agent.identity?.emoji || "🤖";
      const model = agent.model || defaultModel;

      // 查找绑定的平台
      const platforms: { name: string; accountId?: string; appId?: string }[] = [];

      // 检查飞书绑定
      const feishuBinding = bindings.find(
        (b: any) => b.agentId === id && b.match?.channel === "feishu"
      );
      if (feishuBinding) {
        const accountId = feishuBinding.match?.accountId || id;
        const appId = feishuAccounts[accountId]?.appId;
        platforms.push({ name: "feishu", accountId, appId });
      }

      // main agent 特殊处理：默认绑定所有未显式绑定的 channel
      if (id === "main") {
        if (!feishuBinding && channels.feishu?.enabled) {
          const appId = feishuAccounts["main"]?.appId || channels.feishu?.appId;
          platforms.push({ name: "feishu", accountId: "main", appId });
        }
        if (channels.discord?.enabled) {
          platforms.push({ name: "discord" });
        }
      }

      return { id, name, emoji, model, platforms };
    });

    // 提取模型 providers
    const providers = Object.entries(config.models?.providers || {}).map(
      ([providerId, provider]: [string, any]) => {
        const models = (provider.models || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning,
          input: m.input,
        }));

        // 找出使用该 provider 的 agents
        const usedBy = agents
          .filter((a: any) => a.model.startsWith(providerId + "/"))
          .map((a: any) => ({ id: a.id, emoji: a.emoji }));

        return {
          id: providerId,
          api: provider.api,
          models,
          usedBy,
        };
      }
    );

    return NextResponse.json({
      agents,
      providers,
      defaults: { model: defaultModel, fallbacks },
      gateway: { port: config.gateway?.port || 18789, token: config.gateway?.auth?.token || "" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
