import "server-only";
import { ForgecyError, httpStatusFor, PermissionDeniedError } from "@forgecy/core";
import { NextResponse } from "next/server";
import { MAINTENANCE_CODE, maintenanceFor } from "./maintenance";
import { type CurrentUser, getCurrentUser } from "./session";

/** Wrap a route handler: require a session and map domain errors to HTTP statuses. */
export function withUser<A extends unknown[]>(
  fn: (user: CurrentUser, ...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (await maintenanceFor(user))
      return NextResponse.json(
        { error: MAINTENANCE_CODE },
        { status: 503, headers: { "retry-after": "15" } },
      );
    try {
      return await fn(user, ...args);
    } catch (err) {
      if (err instanceof PermissionDeniedError)
        return NextResponse.json({ error: err.code }, { status: 403 });
      if (err instanceof ForgecyError)
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: httpStatusFor[err.code] },
        );
      throw err;
    }
  };
}
