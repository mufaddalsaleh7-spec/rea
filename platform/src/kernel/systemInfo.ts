import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime,
} from "node:os";

/**
 * Host telemetry.
 *
 * ReaOS is a userspace platform running on a host kernel, so the system monitor
 * reports *real* host figures rather than simulated ones. CPU usage is derived
 * from the change in cumulative CPU times between two samples, which is the
 * same technique `top` uses; the first sample therefore has no percentage.
 */

export type SystemFacts = {
  readonly hostname: string;
  readonly platform: string;
  readonly release: string;
  readonly architecture: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly platformVersion: string;
};

export type SystemMetrics = {
  readonly sampledAt: string;
  /** null until a second sample exists (a delta needs two observations). */
  readonly cpuUsagePercent: number | null;
  readonly loadAverage: readonly [number, number, number];
  readonly memory: {
    readonly totalBytes: number;
    readonly freeBytes: number;
    readonly usedPercent: number;
  };
  readonly hostUptimeSeconds: number;
  readonly platformUptimeSeconds: number;
  readonly process: {
    readonly residentBytes: number;
    readonly heapUsedBytes: number;
  };
};

export type SystemInfoProbe = {
  readonly facts: () => SystemFacts;
  readonly metrics: () => SystemMetrics;
};

export type SystemInfoOptions = {
  readonly version: string;
  readonly clock?: () => Date;
  readonly hrtime?: () => number;
};

type CpuTimes = { readonly idleMs: number; readonly totalMs: number };

const readCpuTimes = (): CpuTimes => {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idleMs: idle, totalMs: total };
};

export const createSystemInfoProbe = (
  options: SystemInfoOptions,
): SystemInfoProbe => {
  const clock = options.clock ?? (() => new Date());
  const hrtime = options.hrtime ?? (() => performance.now());
  const startedAt = hrtime();
  const facts = memoizeFacts();
  let previous: CpuTimes | undefined;

  return {
    facts,
    metrics: () => {
      const current = readCpuTimes();
      const cpuUsagePercent =
        previous === undefined
          ? null
          : clampPercent(
              (1 -
                safeRatio(
                  current.idleMs - previous.idleMs,
                  current.totalMs - previous.totalMs,
                )) *
                100,
            );
      previous = current;
      const total = totalmem();
      const free = freemem();
      const loads = loadavg();
      const memory = process.memoryUsage();
      return {
        sampledAt: clock().toISOString(),
        cpuUsagePercent,
        loadAverage: [loads[0] ?? 0, loads[1] ?? 0, loads[2] ?? 0],
        memory: {
          totalBytes: total,
          freeBytes: free,
          usedPercent: clampPercent(((total - free) / total) * 100),
        },
        hostUptimeSeconds: Math.round(uptime()),
        platformUptimeSeconds: Math.round((hrtime() - startedAt) / 1000),
        process: {
          residentBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
        },
      };
    },
  };
};

const memoizeFacts = (): (() => SystemFacts) => {
  let cached: SystemFacts | undefined;
  return () => {
    if (cached !== undefined) return cached;
    const cpuList = cpus();
    cached = {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpuModel: cpuList[0]?.model.trim() ?? "unknown",
      cpuCount: cpuList.length,
      totalMemoryBytes: totalmem(),
      platformVersion: process.env["REAOS_VERSION"] ?? "0.1.0",
    };
    return cached;
  };
};

const safeRatio = (numerator: number, denominator: number): number =>
  denominator <= 0 ? 0 : Math.min(1, Math.max(0, numerator / denominator));

const clampPercent = (value: number): number =>
  Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
