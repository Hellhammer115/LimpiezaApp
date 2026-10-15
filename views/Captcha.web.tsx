import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useImperativeHandle, useRef, useSyncExternalStore, type Ref } from "react";

import { CAPTCHA_SITE_KEY, CaptchaCancelled, type CaptchaHandle } from "@/views/captchaTypes";

const noopSubscribe = () => () => {};

interface Pending {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

/**
 * VIEW — Cloudflare Turnstile challenge (web). See Captcha.tsx for the
 * contract. The widget runs on demand and only becomes visible if Turnstile
 * needs an interaction. Not rendered during static/SSR output, where
 * `window` is absent.
 */
export function Captcha({ ref }: { ref: Ref<CaptchaHandle> }) {
  const widget = useRef<TurnstileInstance>(null);
  const pending = useRef<Pending | null>(null);
  // false on the server render, true once hydrated in a browser.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const settle = (outcome: { token: string } | { error: string }) => {
    const current = pending.current;
    pending.current = null;
    if ("token" in outcome) current?.resolve(outcome.token);
    else current?.reject(new CaptchaCancelled(outcome.error));
  };

  useImperativeHandle(ref, () => ({
    execute: () => {
      if (!CAPTCHA_SITE_KEY) return Promise.resolve(undefined);
      if (!widget.current) return Promise.reject(new CaptchaCancelled("not-ready"));
      pending.current?.reject(new CaptchaCancelled());
      return new Promise<string>((resolve, reject) => {
        pending.current = { resolve, reject };
        // Tokens are single-use: clear the previous one before asking again.
        widget.current?.reset();
        widget.current?.execute();
      });
    },
  }));

  if (!CAPTCHA_SITE_KEY || !mounted) return null;

  return (
    <Turnstile
      ref={widget}
      siteKey={CAPTCHA_SITE_KEY}
      options={{ execution: "execute", appearance: "interaction-only", language: "es" }}
      onSuccess={(token) => settle({ token })}
      onError={(code) => {
        if (__DEV__) console.warn("[captcha] Turnstile error:", code);
        settle({ error: String(code) });
      }}
      onExpire={() => settle({ error: "expired" })}
      style={{ alignSelf: "center" }}
    />
  );
}
