// CONTROLLER — auth: owns the session lifecycle. AuthProvider subscribes
// to Supabase Auth once at the root; useAuth exposes the session to route
// guards; the action helpers are what auth screens call (views never
// import the auth model or Supabase directly).
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";

import * as authModel from "@/models/authModel";
import { cartStore } from "@/models/cartStore";
import { supabase } from "@/services/supabase";

interface AuthState {
  session: Session | null;
  /** True until the persisted session (if any) has been restored. */
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

/** Mounts once at the app root; keeps the session in sync with Supabase. */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Current session + restore state; drives the (auth)/(protected) guards. */
export const useAuth = () => useContext(AuthContext);

/** Signs in with email + password. Throws on bad credentials. */
export const signIn = authModel.signIn;

/** Creates an account; returns false when e-mail confirmation is pending. */
export const signUp = authModel.signUp;

/** Signs out and clears the local cart (it belongs to the leaving user). */
export async function signOut(): Promise<void> {
  cartStore.getState().clear();
  await authModel.signOut();
}
