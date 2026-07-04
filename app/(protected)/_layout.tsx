import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/lib/auth";

export default function ProtectedLayout() {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="cart" options={{ presentation: "modal" }} />
    </Stack>
  );
}
