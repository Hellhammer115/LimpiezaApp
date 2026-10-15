// MODEL — account validation rules shared by every auth/profile form.
// Client-side mirror only: the server enforces the same limits through the
// Supabase Auth password policy (min 8, letters + digits) and the CHECK
// constraints on public.profiles (20261014120000_profile_checks.sql).
// Keep the three in sync.
import { z } from "zod";

export const PASSWORD_MIN = 8;
/** bcrypt (Supabase Auth's hash) ignores everything past 72 bytes. */
export const PASSWORD_MAX = 72;
export const NAME_MAX = 80;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Mínimo ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX, `Máximo ${PASSWORD_MAX} caracteres`)
  .regex(/[A-Za-z]/, "Debe incluir letras")
  .regex(/\d/, "Debe incluir números");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Teléfono a 10 dígitos");

/** Name / last name: required, trimmed, bounded. */
export const nameSchema = (emptyMessage: string) =>
  z
    .string()
    .trim()
    .min(1, emptyMessage)
    .max(NAME_MAX, `Máximo ${NAME_MAX} caracteres`);
