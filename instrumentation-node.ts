import { startLocalWorker } from "./lib/local-worker";
import { startAutomaticBackupScheduler } from "./lib/sync/local-backups";

export async function registerNodeRuntime() {
  await startLocalWorker();
  startAutomaticBackupScheduler();
}
