// app/worker/runner.ts
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { readProduct } from "../lib/product.server";
import * as productWriters from "../lib/product.server";
import { runAgentLoop } from "../agent/loop";
import { complete } from "../agent/anthropic-client.server";
import { runRecipe } from "../agent/recipe-dispatch.server";
import { proposeChange } from "../harness/apply";
import { createDecision } from "../harness/decisions.server";

const MAX_STEPS = 12;

/** Claim and run a single queued job. Returns true if one was processed. */
export async function runOneJob(): Promise<boolean> {
  const candidate = await db.job.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;

  // Atomic claim: flip queued -> running guarded on the status. If a concurrent
  // tick already claimed this row (setInterval does not wait for the async
  // drain, so ticks can overlap when a job runs longer than POLL_MS), count is
  // 0 and we yield without double-processing. Note: a job left "running" by a
  // process crash is NOT re-queued — `attempts` is recorded for visibility, not
  // retry; a failed job is terminal (queued -> running -> done|failed).
  const claim = await db.job.updateMany({
    where: { id: candidate.id, status: "queued" },
    data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claim.count === 0) return true; // lost the race; let the next tick pick up other work
  const job = candidate;

  try {
    const { admin } = await unauthenticated.admin(job.shop);

    const result = await runAgentLoop({
      jobId: job.id,
      productId: job.productId,
      deps: {
        complete,
        readProduct: (id) => readProduct(admin.graphql, id),
        runRecipe: runRecipe as never,
        proposeChange: ({ jobId, product, proposal }) =>
          proposeChange({
            jobId,
            product,
            proposal,
            deps: {
              createDecision,
              writers: {
                writeDescription: productWriters.writeDescription,
                writeProductType: productWriters.writeProductType,
                writeSeo: productWriters.writeSeo,
                writeImageAlt: productWriters.writeImageAlt,
              },
              admin: admin.graphql,
            },
          }),
        maxSteps: MAX_STEPS,
      },
    });

    await db.job.update({
      where: { id: job.id },
      data: {
        status: "done",
        finishedAt: new Date(),
        inputSnapshot: result.snapshot as never,
        trace: result.trace as never,
      },
    });
  } catch (err) {
    await db.job.update({
      where: { id: job.id },
      data: { status: "failed", finishedAt: new Date(), error: String(err) },
    });
  }
  return true;
}
