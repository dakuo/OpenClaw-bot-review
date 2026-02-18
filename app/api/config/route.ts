import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 配置文件路径：优先使用 OPENCLAW_HOME 环境变量，否则默认 ~/.openclaw
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || "", ".openclaw");
const CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");
const OPENCLAW_DIR = OPENCLAW_HOME;

// 从配置的 allowFrom 读取用户 id，用于构建 session key

// 读取 agent 的 session 状态（最近活跃时间、token 用量）
interface SessionStatus {
  lastActive: number | null;
  totalTokens: number;
  contextTokens: number;
  sessionCount: number;
}

function getAgentSessionStatus(agentId: string): SessionStatus {
  const result: SessionStatus = { lastActive: null, totalTokens: 0, contextTokens: 0, sessionCount: 0 };
  try {
    const sessionsPath = path.join(OPENCLAW_DIR, `agents/${agentId}/sessions/sessions.json`);
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const sessions = JSON.parse(raw);
    for (const [, val] of Object.entries(sessions)) {
      const s = val as any;
      result.sessionCount++;
      result.totalTokens += s.totalTokens || 0;
      if (s.contextTokens && s.contextTokens > result.contextTokens) result.contextTokens = s.contextTokens;
      const updatedAt = s.updatedAt || 0;
      if (!result.lastActive || updatedAt > result.lastActive) result.lastActive = updatedAt;
    }
  } catch {}
  return result;
}

// 读取所有 agent 的群聊信息
interface GroupChat {
  groupId: string;
  agents: { id: string; emoji: string; name: string }[];
  channel: string;
}

function getGroupChats(agentIds: string[], agentMap: Record<string, { emoji: string; name: string }>): GroupChat[] {
  const groupAgents: Record<string, { agents: Set<string>; channel: string }> = {};
  for (const agentId of agentIds) {
    try {
      const sessionsPath = path.join(OPENCLAW_DIR, `agents/${agentId}/sessions/sessions.json`);
      const raw = fs.readFileSync(sessionsPath, "utf-8");
      const sessions = JSON.parse(raw);
      for (const key of Object.keys(sessions)) {
        // 匹配群聊 session: agent:{id}:feishu:group:{groupId} 或 agent:{id}:discord:channel:{channelId}
        const feishuGroup = key.match(/^agent:[^:]+:feishu:group:(.+)$/);
        const discordGroup = key.match(/^agent:[^:]+:discord:channel:(.+)$/);
        if (feishuGroup) {
          const gid = `feishu:${feishuGroup[1]}`;
          if (!groupAgents[gid]) groupAgents[gid] = { agents: new Set(), channel: "feishu" };
          groupAgents[gid].agents.add(agentId);
        }
        if (discordGroup) {
          const gid = `discord:${discordGroup[1]}`;
          if (!groupAgents[gid]) groupAgents[gid] = { agents: new Set(), channel: "discord" };
          groupAgents[gid].agents.add(agentId);
        }
      }
    } catch {}
  }
  return Object.entries(groupAgents)
    .filter(([, v]) => v.agents.size > 0)
    .map(([groupId, v]) => ({
      groupId,
      channel: v.channel,
      agents: Array.from(v.agents).map(id => ({ id, emoji: agentMap[id]?.emoji || "🤖", name: agentMap[id]?.name || id })),
    }));
}

// 从 OpenClaw sessions 文件获取每个 agent 最近活跃的飞书 DM session 的用户 open_id
function getFeishuUserOpenIds(agentIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const agentId of agentIds) {
    try {
      const sessionsPath = path.join(OPENCLAW_DIR, `agents/${agentId}/sessions/sessions.json`);
      const raw = fs.readFileSync(sessionsPath, "utf-8");
      const sessions = JSON.parse(raw);
      let best: { openId: string; updatedAt: number } | null = null;
      for (const [key, val] of Object.entries(sessions)) {
        const m = key.match(/^agent:[^:]+:feishu:direct:(ou_[a-f0-9]+)$/);
        if (m) {
          const updatedAt = (val as any).updatedAt || 0;
          if (!best || updatedAt > best.updatedAt) {
            best = { openId: m[1], updatedAt };
          }
        }
      }
      if (best) map[agentId] = best.openId;
    } catch {}
  }
  return map;
}
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

    // 从 OpenClaw sessions 文件获取每个 agent 飞书 DM 的用户 open_id
    const agentIds = agentList.map((a: any) => a.id);
    const feishuUserOpenIds = getFeishuUserOpenIds(agentIds);
    const discordDmAllowFrom = channels.discord?.dm?.allowFrom || [];

    // 构建 agent 详情
    const agents = await Promise.all(agentList.map(async (agent: any) => {
      const id = agent.id;
      const identityName = readIdentityName(id, agent.agentDir, agent.workspace);
      const name = identityName || agent.name || id;
      const emoji = agent.identity?.emoji || "🤖";
      const model = agent.model || defaultModel;

      // 查找绑定的平台
      const platforms: { name: string; accountId?: string; appId?: string; botOpenId?: string; botUserId?: string }[] = [];

      // 检查飞书绑定
      const feishuBinding = bindings.find(
        (b: any) => b.agentId === id && b.match?.channel === "feishu"
      );
      if (feishuBinding) {
        const accountId = feishuBinding.match?.accountId || id;
        const acc = feishuAccounts[accountId];
        const appId = acc?.appId;
        const userOpenId = feishuUserOpenIds[id] || null;
        platforms.push({ name: "feishu", accountId, appId, ...(userOpenId && { botOpenId: userOpenId }) });
      }

      // main agent 特殊处理：默认绑定所有未显式绑定的 channel
      if (id === "main") {
        if (!feishuBinding && channels.feishu?.enabled) {
          const acc = feishuAccounts["main"];
          const appId = acc?.appId || channels.feishu?.appId;
          const userOpenId = feishuUserOpenIds["main"] || null;
          platforms.push({ name: "feishu", accountId: "main", appId, ...(userOpenId && { botOpenId: userOpenId }) });
        }
        if (channels.discord?.enabled) {
          const botUserId = discordDmAllowFrom[0] || null;
          platforms.push({ name: "discord", ...(botUserId && { botUserId }) });
        }
      }

      return { id, name, emoji, model, platforms };
    }));

    // 为每个 agent 添加 session 状态
    const agentsWithStatus = agents.map((agent: any) => ({
      ...agent,
      session: getAgentSessionStatus(agent.id),
    }));

    // 构建 agent 映射（用于群聊）
    const agentMap: Record<string, { emoji: string; name: string }> = {};
    for (const a of agentsWithStatus) agentMap[a.id] = { emoji: a.emoji, name: a.name };

    // 获取群聊信息
    const groupChats = getGroupChats(agentIds, agentMap);

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
        const usedBy = agentsWithStatus
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
      agents: agentsWithStatus,
      providers,
      defaults: { model: defaultModel, fallbacks },
      gateway: { port: config.gateway?.port || 18789, token: config.gateway?.auth?.token || "" },
      groupChats,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
