import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import aesjs from "aes-js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";

import { DEMO_MODE } from "@/models/demoData";

// Expo static web output renders this module in Node first (SSR), where
// there is no window/localStorage — touching storage there crashes the
// process. Persist sessions only on a real client.
const isServer = Platform.OS === "web" && typeof window === "undefined";

// Session tokens are encrypted at rest: the AES-256 key lives in the device
// Keychain/Keystore (SecureStore has a 2KB value limit, sessions are bigger),
// the ciphertext lives in AsyncStorage.
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(
      encryptionKey,
      new aesjs.Counter(1)
    );
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encrypted);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const hexKey = await SecureStore.getItemAsync(key);
    if (!hexKey) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(hexKey),
      new aesjs.Counter(1)
    );
    const decrypted = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decrypted);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

// In demo mode the client is never actually queried; placeholders keep the
// module loadable without a .env pointing at a real project.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (DEMO_MODE ? "https://demo.invalid" : undefined);
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (DEMO_MODE ? "demo" : undefined);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan EXPO_PUBLIC_SUPABASE_URL y/o EXPO_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env y llénalo (o usa EXPO_PUBLIC_DEMO=1 para previsualizar)."
  );
}

// Native: AES-encrypted storage (key in Keychain/Keystore). Browser:
// AsyncStorage (localStorage) — the standard supabase-js web setup.
// SSR: no storage at all.
const sessionStorage = isServer
  ? undefined
  : Platform.OS === "web"
    ? AsyncStorage
    : new LargeSecureStore();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
if (!isServer) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
