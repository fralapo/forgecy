ALTER TABLE "jobs" DROP CONSTRAINT "jobs_depends_on_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "depends_on_job_id";