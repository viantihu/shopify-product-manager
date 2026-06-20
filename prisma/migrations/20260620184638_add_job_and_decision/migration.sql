-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "inputSnapshot" JSONB,
    "trace" JSONB
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recipe" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT NOT NULL,
    "agentReason" TEXT NOT NULL,
    "gateDecision" TEXT NOT NULL,
    "gateReason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewerVerdict" TEXT,
    "finalValue" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    CONSTRAINT "Decision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Decision_status_idx" ON "Decision"("status");

-- CreateIndex
CREATE INDEX "Decision_jobId_idx" ON "Decision"("jobId");
