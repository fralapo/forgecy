/** Website import is enabled by default; set the environment flag to "false" to disable it. */
export function websiteIngestEnabled(
  enabled=process.env.ENABLE_WEBSITE_INGEST
):boolean {
  return enabled !== "false";
}
