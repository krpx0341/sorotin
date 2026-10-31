import { spawnSync, type ChildProcess } from "node:child_process";

export class JobAbortedError extends Error {
  constructor(studioId: string) {
    super(`Job stopped: ${studioId}`);
    this.name = "JobAbortedError";
  }
}

type JobHandle = {
  controller: AbortController;
  children: Set<ChildProcess>;
};

// One registry per server process, shared across route bundles and HMR reloads
// (a plain module-level Map can be duplicated per route in dev, which made Stop
// from one route unable to see a job started by another).
const g = globalThis as typeof globalThis & { __clipperJobs?: Map<string, JobHandle> };
const jobs: Map<string, JobHandle> = (g.__clipperJobs ??= new Map<string, JobHandle>());

/** True when this server process is actually running a job for the studio. */
export function hasActiveJob(studioId: string): boolean {
  const h = jobs.get(studioId);
  return Boolean(h && !h.controller.signal.aborted);
}

export function beginJob(studioId: string): AbortSignal {
  const existing = jobs.get(studioId);
  if (existing) {
    existing.controller.abort();
    for (const child of existing.children) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    jobs.delete(studioId);
  }
  const controller = new AbortController();
  const handle: JobHandle = { controller, children: new Set() };
  jobs.set(studioId, handle);
  return controller.signal;
}

export function endJob(studioId: string, signal?: AbortSignal) {
  const handle = jobs.get(studioId);
  if (!handle) return;
  if (signal && handle.controller.signal !== signal) return;
  jobs.delete(studioId);
}

export function trackChild(studioId: string, child: ChildProcess) {
  const handle = jobs.get(studioId);
  if (!handle) return;
  handle.children.add(child);
  const drop = () => handle.children.delete(child);
  child.on("exit", drop);
  child.on("error", drop);
}

export function isJobAborted(studioId: string): boolean {
  return Boolean(jobs.get(studioId)?.controller.signal.aborted);
}

export function assertNotAborted(studioId: string) {
  const handle = jobs.get(studioId);
  if (handle?.controller.signal.aborted) {
    throw new JobAbortedError(studioId);
  }
}

/** Soft + hard stop: abort signal, kill tracked children, best-effort pkill by studio path. */
export function stopJob(studioId: string): boolean {
  const handle = jobs.get(studioId);
  const stopped = Boolean(handle);
  if (handle) {
    handle.controller.abort();
    for (const child of handle.children) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      for (const child of handle.children) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }, 1500);
    jobs.delete(studioId);
  }

  try {
    const pattern = `personal-clipper/data/studios/${studioId}`;
    spawnSync("pkill", ["-f", pattern], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  return stopped;
}

export function isBusyStatus(status: string) {
  return ["queued", "downloading", "transcribing", "clipping", "rendering"].includes(status);
}
