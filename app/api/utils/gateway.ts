export function isGatewayRunning(): boolean {
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
