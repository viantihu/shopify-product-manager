// app/worker/start.server.ts
import { runOneJob } from "./runner";

declare global {
  // eslint-disable-next-line no-var
  var __completenessWorker: NodeJS.Timeout | undefined;
}

const POLL_MS = 3000;

/** Start a single in-process poller (guarded against duplicate starts). */
export function startWorker(): void {
  if (global.__completenessWorker) return;
  global.__completenessWorker = setInterval(async () => {
    try {
      // Drain quickly: keep going while there is work.
      while (await runOneJob()) { /* loop */ }
    } catch (e) {
      console.error("worker tick failed:", e);
    }
  }, POLL_MS);
  console.log("Product-completeness worker started.");
}
