/**
 * Runtime identity for one running instance.
 *
 * A preview URL is derived, never guessed: the platform exposes the sandbox id
 * in the environment and the port is known at bind time. Publishing both through
 * `/api/instance` means an operator (or an agent) can discover where the app is
 * listening without inspecting processes, and can tell a TallyCraft listener
 * apart from a foreign process that happens to hold the same port.
 */

export const SERVICE_NAME = "tallycraft";

/** Preview URL for a port in this sandbox, or null when not sandboxed. */
export function previewUrlFor(port, sandboxId) {
  if (!Number.isInteger(port) || port <= 0) return null;
  if (typeof sandboxId !== "string" || sandboxId.trim() === "") return null;
  return `https://${port}-${sandboxId.trim()}.e2b.app`;
}

/**
 * Build the identity payload served at `/api/instance` and written to
 * `.runtime/preview.json`.
 */
export function instanceInfo({
  port,
  host = "0.0.0.0",
  sandboxId = undefined,
  startedAt = new Date(),
  pid = process.pid,
  dbPath = null,
  commit = null,
  branch = null,
  supervisorPid = null,
}) {
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt);
  return {
    service: SERVICE_NAME,
    status: "ok",
    pid,
    supervisorPid,
    host,
    port,
    localUrl: `http://127.0.0.1:${port}`,
    previewUrl: previewUrlFor(port, sandboxId),
    sandboxId: sandboxId ?? null,
    startedAt: started.toISOString(),
    uptimeSeconds: Math.max(
      0,
      Math.round((Date.now() - started.getTime()) / 1000),
    ),
    database: dbPath,
    git: { branch, commit },
  };
}

/** True when a probe response came from this service on any port. */
export function isTallyCraftInstance(payload) {
  return (
    payload !== null &&
    typeof payload === "object" &&
    payload.service === SERVICE_NAME &&
    payload.status === "ok"
  );
}
