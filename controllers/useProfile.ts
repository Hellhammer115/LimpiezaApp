// CONTROLLER — profile: read/update the signed-in user's profile.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import { DEMO_MODE } from "@/models/demoData";
import {
  fetchProfile,
  updateProfile,
  type ProfilePatch,
} from "@/models/profileModel";

/** The caller's profile row (or the demo profile in demo mode). */
export function useProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["profile", userId],
    enabled: DEMO_MODE || !!userId,
    queryFn: () => fetchProfile(userId ?? ""),
  });
}

/** Saves name / last name / phone, then refreshes the cached profile. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: (patch: ProfilePatch) =>
      updateProfile(session!.user.id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}
