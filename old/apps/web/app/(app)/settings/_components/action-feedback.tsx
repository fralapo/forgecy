import type { AdminActionResult } from "../_lib/admin-action";

/** Result line under an Admin form: success as status, failure as alert with its code. */
export function ActionFeedback({ result }: { result: AdminActionResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <p role="status" className="text-body-sm text-success">
      {result.message}
    </p>
  ) : (
    <p role="alert" className="text-body-sm text-error">
      {result.error} {result.code ? <span className="font-mono">{result.code}</span> : null}
    </p>
  );
}
