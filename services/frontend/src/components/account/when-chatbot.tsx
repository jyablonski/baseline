"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { useFeatures } from "@/lib/account";

/** Renders its children only while chat is offered: the flag is on and a model key is set. */
export function WhenChatbot({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const { chatbot } = useFeatures();
  // The server never knows the flags, so the first client render must not either.
  return hydrated && chatbot ? children : null;
}
