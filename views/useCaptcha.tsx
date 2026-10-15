import { useCallback, useRef } from "react";

import { Captcha } from "@/views/Captcha";
import type { CaptchaHandle } from "@/views/captchaTypes";

/**
 * Captcha for a form: render `element` once in the screen and `await
 * execute()` in the submit handler to get a fresh token (undefined when
 * captcha isn't configured). Wrapped in a hook so screens never touch the
 * ref during render (React Compiler `react-hooks/refs`).
 */
export function useCaptcha() {
  const handle = useRef<CaptchaHandle>(null);
  const execute = useCallback(
    () => handle.current?.execute() ?? Promise.resolve(undefined),
    []
  );
  return { element: <Captcha ref={handle} />, execute };
}
