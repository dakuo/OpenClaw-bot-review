# 🐈 nanobot Dashboard

A lightweight web dashboard for viewing all your nanobot Bots/Agents/Sessions status at a glance.

Bots Dashboard:
![Dashboard Preview](docs/bot_dashboard.png)

Pixel Office:
![Pixel Office](docs/pixel-office.png)

## Background

When running multiple nanobot agents across different channels (Telegram, Discord, Slack, WhatsApp, Feishu, DingTalk, Email, QQ, Matrix, Mochat), managing and monitoring them becomes increasingly complex — which bot uses which model? Are the channels connected? Is the gateway healthy? How are tokens being consumed?

This dashboard reads your local nanobot configuration and session data, providing a unified web UI to monitor and test all your agents, models, channels, and sessions in real time. No database required — everything is derived directly from `~/.nanobot/config.json` and local session files. Plus, a fun pixel-art office brings your agents to life as animated characters walking around, sitting at desks, and interacting with furniture.

## Features

- **Bot Overview** — Card wall showing all agents with name, emoji, model, channel bindings, session stats, and gateway health status
- **Model List** — View all configured providers and models with context window, max output, reasoning support, and per-model test
- **Session Management** — Browse all sessions per agent with type detection (DM, group, cron), token usage, and connectivity test
- **Statistics** — Token consumption and average response time trends with daily/weekly/monthly views and SVG charts
- **Skill Management** — View all installed skills (built-in, extension, custom) with search and filter
- **Alert Center** — Configure alert rules (model unavailable, bot no response) with notification delivery
- **Gateway Health** — Real-time gateway status indicator with 10s auto-polling and one-click jump to nanobot web UI
- **Platform Test** — One-click connectivity test for all channel bindings and DM sessions
- **Auto Refresh** — Configurable refresh interval (manual, 10s, 30s, 1min, 5min, 10min)
- **i18n** — Chinese and English UI language switching
- **Dark/Light Theme** — Theme switcher in sidebar
- **Pixel Office** — Animated pixel-art office where agents appear as characters that walk, sit, and interact with furniture in real time（The feature is inspired by Pixel Agents）
- **Live Config** — Reads directly from `~/.nanobot/config.json` and local session files, no database needed

## Preview

![Dashboard Preview](docs/bot_dashboard.png)

![Models Preview](docs/models-preview.png)

![Sessions Preview](docs/sessions-preview.png)

![Pixel Office](docs/pixel-office.png)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/your-org/nanobot-dashboard.git
cd nanobot-dashboard

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- Next.js + TypeScript
- Tailwind CSS
- No database — reads config file directly

## Requirements

- Node.js 18+
- nanobot installed with config at `~/.nanobot/config.json`

## Configuration

By default, the dashboard reads config from `~/.nanobot/config.json`. To use a custom path, set the `NANOBOT_HOME` environment variable:

```bash
NANOBOT_HOME=/opt/nanobot npm run dev
```

## Docker Deployment

You can also deploy the dashboard using Docker:

### Build Docker Image

```bash
docker build -t nanobot-dashboard .
```

### Run Container

```bash
# Basic run
docker run -d -p 3000:3000 nanobot-dashboard

# With custom nanobot config path
docker run -d --name nanobot-dashboard -p 3000:3000 -e NANOBOT_HOME=/opt/nanobot -v /path/to/nanobot:/opt/nanobot nanobot-dashboard
```
