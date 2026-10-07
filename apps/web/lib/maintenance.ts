import "server-only";
import { readRestoreStatus, restoreInProgress, type RestoreStatus } from "@forgecy/backup";
import { resolveMediaRoot } from "@forgecy/files";
import { env } from "./env";

/** Error code of the maintenance page and of API answers during a restore. */
export const MAINTENANCE_CODE = "MAINTENANCE-RESTORE";

/** The restore in progress, if any (spec page 70: 503 maintenance). */
export async function restoreUnderway(): Promise<RestoreStatus | null> {
  const status = await readRestoreStatus(resolveMediaRoot(env.FORGECY_DATA_DIR));
  return status && restoreInProgress(status) ? status : null;
}

/**
 * Whether this person waits on the maintenance page: during a restore everyone but the
 * Admin who started it (page 67). Restores started before this was recorded spare Admins.
 */
export async function maintenanceFor(user: {
  id: string;
  isAdmin: boolean;
}): Promise<RestoreStatus | null> {
  const status = await restoreUnderway();
  if (!status) return null;
  const exempt = status.requestedById ? status.requestedById === user.id : user.isAdmin;
  return exempt ? null : status;
}
