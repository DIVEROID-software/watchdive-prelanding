import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Data-saving visitors and slow connections get posters instead of clips and
 * the smallest photo cuts.
 *
 * Two signals, read where each is available. The `Save-Data: on` request
 * header reaches the server with the first navigation, so the hero photo can
 * be served small before any script runs. `navigator.connection` (saveData,
 * or an effective type of 3g or slower) is only readable in the browser, and
 * only in Chromium, so it governs what loads after hydration: videos and the
 * lazy photos further down. Neither signal is stored or sent anywhere.
 */

type ConnectionLike = { saveData?: boolean; effectiveType?: string };

export function isConstrainedConnection(connection: ConnectionLike | undefined | null): boolean {
  if (!connection) return false;
  return connection.saveData === true || /^(?:slow-2g|2g|3g)$/.test(connection.effectiveType ?? "");
}

export function saveDataRequested(header: string | null | undefined): boolean {
  return (header ?? "").trim().toLowerCase() === "on";
}

function browserConnection(): ConnectionLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}

/** For route loaders: the request header on the server, the connection on a client navigation. */
export const readLiteMediaHint = createIsomorphicFn()
  .server(() => saveDataRequested(getRequestHeader("save-data")))
  .client(() => isConstrainedConnection(browserConnection()));

/** The loader's hint, identical in the server render and at hydration. */
export function useLiteMediaHint(): boolean {
  return useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => (match.loaderData as { liteMedia?: boolean } | undefined)?.liteMedia === true,
      ),
  });
}

/**
 * The loader's hint, widened after mount by the browser's own connection
 * signal. Starts from the hint so the first client render matches the server.
 */
export function useLiteMedia(): boolean {
  const hint = useLiteMediaHint();
  const [constrained, setConstrained] = useState(false);
  useEffect(() => {
    const connection = browserConnection() as (ConnectionLike & Partial<EventTarget>) | undefined;
    const update = () => setConstrained(isConstrainedConnection(connection));
    update();
    connection?.addEventListener?.("change", update);
    return () => connection?.removeEventListener?.("change", update);
  }, []);
  return hint || constrained;
}
