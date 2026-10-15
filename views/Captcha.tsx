import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { CAPTCHA_SITE_KEY, CaptchaCancelled, type CaptchaHandle } from "@/views/captchaTypes";

// Turnstile only runs on hostnames allowed for the widget in the Cloudflare
// dashboard, so the WebView page is served "from" one of them.
const BASE_URL = process.env.EXPO_PUBLIC_CAPTCHA_BASE_URL ?? "";

if (__DEV__ && CAPTCHA_SITE_KEY && !BASE_URL) {
  console.warn("[captcha] EXPO_PUBLIC_CAPTCHA_BASE_URL is unset; Turnstile will reject the native widget.");
}

/** Minimal page that renders Turnstile and posts its result back to RN. */
const html = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:transparent}</style>
<script>
  function post(type, value) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, value: value }));
  }
  function onTurnstileLoad() {
    turnstile.render("#widget", {
      sitekey: ${JSON.stringify(CAPTCHA_SITE_KEY)},
      language: "es",
      appearance: "interaction-only",
      callback: function (token) { post("token", token); },
      "error-callback": function (code) { post("error", String(code)); return true; },
      "expired-callback": function () { post("error", "expired"); },
      "timeout-callback": function () { post("error", "timeout"); },
      "before-interactive-callback": function () { post("interactive"); }
    });
  }
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit" async defer></script>
</head><body><div id="widget"></div></body></html>`;

interface Pending {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

/**
 * VIEW — Cloudflare Turnstile challenge (native: WebView in a modal).
 * Mounted only while `execute()` is pending, so every call gets a fresh,
 * single-use token that Supabase Auth verifies server-side. Without a site
 * key configured it's a no-op that resolves `undefined`.
 */
export function Captcha({ ref }: { ref: Ref<CaptchaHandle> }) {
  const pending = useRef<Pending | null>(null);
  const [visible, setVisible] = useState(false);
  const [interactive, setInteractive] = useState(false);

  const settle = (outcome: { token: string } | { error: string }) => {
    const current = pending.current;
    pending.current = null;
    setVisible(false);
    setInteractive(false);
    if ("token" in outcome) current?.resolve(outcome.token);
    else current?.reject(new CaptchaCancelled(outcome.error));
  };

  useImperativeHandle(ref, () => ({
    execute: () => {
      if (!CAPTCHA_SITE_KEY) return Promise.resolve(undefined);
      pending.current?.reject(new CaptchaCancelled());
      return new Promise<string>((resolve, reject) => {
        pending.current = { resolve, reject };
        setVisible(true);
      });
    },
  }));

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type: string; value?: string };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === "interactive") setInteractive(true);
    else if (message.type === "token" && message.value) settle({ token: message.value });
    else if (message.type === "error") {
      if (__DEV__) console.warn("[captcha] Turnstile error:", message.value);
      settle({ error: message.value ?? "error" });
    }
  };

  if (!CAPTCHA_SITE_KEY || !visible) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={() => settle({ error: "cancel" })}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5">
          <Text className="mb-3 font-quicksand-bold text-base text-dark-100">
            {interactive ? "Confirma que no eres un robot" : "Verificando…"}
          </Text>
          {/* Turnstile's interactive widget is ~300×65; keep room for it. */}
          <View style={{ width: 300, height: 70 }}>
            <WebView
              source={{ html, baseUrl: BASE_URL }}
              originWhitelist={["*"]}
              javaScriptEnabled
              onMessage={onMessage}
              onError={() => settle({ error: "webview-error" })}
              style={{ backgroundColor: "transparent" }}
            />
            {!interactive ? (
              <View className="absolute inset-0 items-center justify-center bg-white">
                <ActivityIndicator />
              </View>
            ) : null}
          </View>
          <Pressable onPress={() => settle({ error: "cancel" })} hitSlop={8} className="mt-3">
            <Text className="font-quicksand-semibold text-sm text-dark-100/60">Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
