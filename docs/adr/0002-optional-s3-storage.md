# 0002 · Optional S3 storage with SeaweedFS instead of MinIO

- Status: accepted (M1)
- Date: 2026-10-05

## Context

The specification names local disk as the default storage and MinIO as the alternative. MinIO Community Edition has not published Docker images since October 2025 and the repository was archived in 2026.

## Decision

The default stays the disk (`STORAGE_DRIVER=local`, files in `./data/media`). The `s3` driver of `packages/files` works with any S3-compatible storage; the Compose `s3` profile includes SeaweedFS (Apache 2.0) for those who want object storage on the same machine.

## Consequences

No paid dependencies. Anyone who already has S3-compatible storage (Garage, Ceph, an external bucket) sets `S3_ENDPOINT` and the keys without changing code.
