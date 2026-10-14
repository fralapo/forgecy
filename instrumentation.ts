export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startLocalWorker } = await import("./lib/local-worker");
  await startLocalWorker();
  const { startAutomaticBackupScheduler } = await import("./lib/sync/local-backups");
  startAutomaticBackupScheduler();
}
