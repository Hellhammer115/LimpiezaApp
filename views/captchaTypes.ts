// Shared contract of views/Captcha.tsx (native) and views/Captcha.web.tsx.
// Provider: Cloudflare Turnstile, verified server-side by Supabase Auth.

/** Public Turnstile site key; the secret lives only in Supabase Auth settings. */
export const CAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_CAPTCHA_SITE_KEY ?? "";

export interface CaptchaHandle {
  /**
   * Runs a challenge and resolves with a fresh single-use token, or
   * `undefined` when captcha isn't configured. Rejects with
   * CaptchaCancelled when the user closes it or it errors/expires.
   */
  execute: () => Promise<string | undefined>;
}

export class CaptchaCancelled extends Error {
  constructor(reason = "cancel") {
    super(reason);
    this.name = "CaptchaCancelled";
  }
}
