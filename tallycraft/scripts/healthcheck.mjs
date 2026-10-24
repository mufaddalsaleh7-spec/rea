/**
 * Container health probe.
 *
 * Docker runs this inside the container, so it must be dependency-free, fast,
 * and honest: exit 0 only when the app answers its own health route.
 *
 * Usage: node scripts/healthcheck.mjs [--url http://127.0.0.1:3000/healthz]
 */

const timeoutMs = Number(process.env.TALLYCRAFT_HEALTH_TIMEOUT_MS ?? 2_500);

function targetUrl() {
  const flagIndex = process.argv.indexOf("--url");
  if (flagIndex !== -1 && process.argv[flagIndex + 1] !== undefined) {
    return process.argv[flagIndex + 1];
  }
  if (process.env.TALLYCRAFT_HEALTH_URL)
    return process.env.TALLYCRAFT_HEALTH_URL;
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}/healthz`;
}

async function main() {
  const url = targetUrl();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/plain" },
    });
    const body = (await response.text()).trim();
    if (response.ok && body === "ok") return 0;
    console.error(
      `unhealthy: ${url} -> ${response.status} "${body.slice(0, 60)}"`,
    );
    return 1;
  } catch (error) {
    console.error(`unhealthy: ${url} -> ${error.message}`);
    return 1;
  }
}

process.exitCode = await main();
