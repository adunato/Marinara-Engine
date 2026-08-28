// ──────────────────────────────────────────────
// Hook: Idle Detection
// ──────────────────────────────────────────────
// Detects user inactivity (mouse, keyboard, touch) and
// auto-sets status to "idle" after 10 minutes, reverting
// to "active" when the user returns.

import { useEffect, useRef } from "react";
import { queueActiveUserProfileContinuity } from "./use-user-profiles";
import { useUserProfileStore } from "../stores/user-profile.store";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function useIdleDetection() {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isIdleRef = useRef(false);

  useEffect(() => {
    const resetTimer = () => {
      const profile = useUserProfileStore.getState().activeProfile;
      if (!profile) return;
      const { userStatus, userStatusManual } = profile;
      // Only manage idle if the user's manual choice is "active"
      if (userStatusManual !== "active") return;

      if (isIdleRef.current || userStatus === "idle") {
        isIdleRef.current = false;
        queueActiveUserProfileContinuity({ userStatus: "active" });
      }

      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const activeProfile = useUserProfileStore.getState().activeProfile;
        if (activeProfile?.userStatusManual === "active") {
          isIdleRef.current = true;
          queueActiveUserProfileContinuity({ userStatus: "idle" });
        }
      }, IDLE_TIMEOUT_MS);
    };

    // Activity events
    const events = ["pointermove", "pointerdown", "mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"] as const;
    for (const evt of events) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }

    // Also detect visibility change (tab switch back)
    const onVisibility = () => {
      if (!document.hidden) resetTimer();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Start the timer
    resetTimer();

    return () => {
      clearTimeout(timerRef.current);
      for (const evt of events) {
        window.removeEventListener(evt, resetTimer);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
