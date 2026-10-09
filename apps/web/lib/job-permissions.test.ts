import { systemBackupJob, systemRestoreJob } from "@forgecy/backup";
import { clientExportJob, clientImportJob, clientImportVerifyJob } from "@forgecy/client-transfer";
import { JOB_KIND_PERMISSIONS } from "@forgecy/core";
import { describe, expect, it } from "vitest";

describe("admin-only job kinds", () => {
  it("are all listed in JOB_KIND_PERMISSIONS", () => {
    for (const job of [
      systemBackupJob,
      systemRestoreJob,
      clientExportJob,
      clientImportVerifyJob,
      clientImportJob,
    ])
      expect(JOB_KIND_PERMISSIONS.has(job.kind), job.kind).toBe(true);
  });
});
