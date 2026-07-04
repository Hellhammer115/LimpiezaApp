import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/demo";

export default function AuthLayout() {
  const { session, loading } = useAuth();

  // In demo mode login is disabled entirely: any route into the auth group
  // bounces straight to home.
  if (DEMO_MODE) return <Redirect href="/" />;

  if (loading) return null;
  if (session) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
