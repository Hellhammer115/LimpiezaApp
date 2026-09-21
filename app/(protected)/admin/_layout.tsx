// VIEW — admin group guard: reachable only for signed-in admins.
import { Redirect, Stack } from "expo-router";

import { useIsAdmin } from "@/controllers/useAdmin";

export default function AdminLayout() {
  const { data: isAdmin, isLoading } = useIsAdmin();

  if (isLoading) return null;
  if (!isAdmin) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
