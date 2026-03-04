/**
 * Build a gateway URL.
 * - Prefer explicit host override from backend config when provided.
 * - Fallback to current browser hostname for LAN access.
 * - SSR fallback: localhost.
 */
export function buildGatewayUrl(
  port: number,
  path: string,
  params?: Record<string, string>,
  hostOverride?: string,
): string {
  let host = (hostOverride && hostOverride.trim()) || (typeof window !== "undefined" ? window.location.hostname : "localhost");
  if (host.includes("://")) host = new URL(host).hostname;
  if (host === "0.0.0.0" || host === "::") host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const normalizedHost = host;
  const url = new URL(`http://${normalizedHost}:${port}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}
