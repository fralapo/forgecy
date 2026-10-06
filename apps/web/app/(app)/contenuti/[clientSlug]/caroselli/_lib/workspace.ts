import "server-only";
import { getCarouselWorkspace } from "@forgecy/content";
import { ForgecyError } from "@forgecy/core";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadClient } from "../../../_lib/server";

/** Client, user and carousel workspace, read once per request (layout and page share it). */
export const loadCarousel = cache(async (slug: string, contentId: string) => {
  const { db, user, client } = await loadClient(slug);
  try {
    const ws = await getCarouselWorkspace(db, user.actor, client.id, contentId);
    return { db, user, client, ws };
  } catch (err) {
    if (err instanceof ForgecyError && err.code === "not_found") notFound();
    throw err;
  }
});

/** A job still in the queue or at work: the page refreshes until it ends. */
export const isActiveJob = (status: string) =>
  status === "queued" || status === "running" || status === "retrying";
