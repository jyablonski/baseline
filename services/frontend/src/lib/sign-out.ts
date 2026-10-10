"use client";

import { signOutAction } from "@/app/account/actions";

/**
 * Go home with a full page load, not a client navigation: it discards the
 * session, picks and quota the browser has cached for a session that just ended.
 */
export function reloadHome() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the router would keep the react-query cache
  window.location.assign("/");
}

export async function signOutAndReload() {
  await signOutAction();
  reloadHome();
}
