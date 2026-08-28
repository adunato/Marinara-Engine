import { api } from "./api-client";
import type { UserStatus } from "../stores/ui.store";
import { toAutonomousPresenceStatus } from "./user-status";
import { queueActiveUserProfileContinuity } from "../hooks/use-user-profiles";
import { useUserProfileStore } from "../stores/user-profile.store";

export function restoreAvailableAfterUserMessage(): UserStatus {
  const profile = useUserProfileStore.getState().activeProfile;
  const userStatus = profile?.userStatus ?? "active";
  const userStatusManual = profile?.userStatusManual ?? "active";

  if (userStatusManual === "active" && userStatus === "idle") {
    queueActiveUserProfileContinuity({ userStatus: "active" });
    return "active";
  }

  return userStatus;
}

export async function recordUserMessageActivity(
  chatId: string,
  options: { preserveGenerationInProgress?: boolean } = {},
): Promise<void> {
  const userStatus = restoreAvailableAfterUserMessage();

  await Promise.allSettled([
    api.post("/conversation/activity/user", {
      chatId,
      preserveGenerationInProgress: options.preserveGenerationInProgress === true,
    }),
    api.post("/conversation/activity/presence", { chatId, userStatus: toAutonomousPresenceStatus(userStatus) }),
  ]);
}
