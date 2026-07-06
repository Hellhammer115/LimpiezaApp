# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LimpiezaApp: a production-targeted grocery/cleaning-products delivery app (Calii-style, Mexico, MXN, Spanish UI) built with Expo SDK 54 + React Native + expo-router + NativeWind, Supabase (Postgres/Auth/Edge Functions) and Mercado Pago Checkout Pro. Repo work happens on `feature/limpiezaapp-production` (PR #1).

## Commands

```sh
npx expo start --port 8081        # dev server; add --offline if api.expo.dev is unreachable
npx tsc --noEmit                  # typecheck (no test suite exists yet)
npx expo lint                     # ESLint
npx expo-doctor                   # project health

# Supabase (server side)
npx supabase db push                              # apply supabase/migrations
npx supabase functions deploy create-order
npx supabase functions deploy mp-webhook --no-verify-jwt   # MP calls it without a JWT; it validates x-signature instead
```

App config: copy `.env.example` → `.env`. `EXPO_PUBLIC_DEMO=1` enables demo mode (bundled sample catalog from `models/demoData.ts`, auth bypassed, no backend needed). Real mode needs `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`. MP secrets (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`) live only in `supabase secrets`, never in `.env`.

## Architecture (MVC)

Strict layering — views never import Supabase or models directly; the flow is always view → controller → model:

- `models/` — data access + domain rules. All Supabase queries live here (`catalogModel`, `orderModel`, `profileModel`, `addressModel`, `authModel`, `paymentModel`), plus the persisted zustand cart (`cartStore`), demo data, `delivery.ts` (fee rules) and `orderStatus.ts` (status labels/predicates).
- `controllers/` — hooks consumed by views: TanStack Query wrappers (`useCatalog`, `useOrders`, `useProfile`, `useAddresses`), session context (`useAuth` — `AuthProvider` mounts at root), cart selectors (`useCart`: prefer the primitive selectors `useInCart`/`useCartCount`/`useCartSubtotal` to avoid grid-wide re-renders), and `useCheckout` (whole payment flow orchestration).
- `views/` — reusable UI components; `app/` — routed screens (expo-router requires them there; they are thin views).
- `services/supabase.ts` — the client. Session storage is platform-dependent: AES-encrypted (key in Keychain/Keystore) on native, localStorage on web browser, DISABLED during SSR — Expo's static web output executes this module in Node where `window` doesn't exist, and touching storage there crashes the dev server.
- `supabase/functions/` — **Deno** code (`Deno.serve`, `npm:` imports). Excluded from the app tsconfig; VS Code uses the Deno extension scoped via `.vscode/settings.json`. Don't "fix" its imports to Node style.

Routing: `app/(auth)` (sign-in/up) and `app/(protected)` (everything else) are guarded by their `_layout.tsx` files using `useAuth` + `DEMO_MODE`. In demo mode the auth group redirects to home.

## Security invariants (do not weaken)

- RLS on every table; catalog is client-read-only; `orders`/`order_items` are written ONLY by Edge Functions with the service role. Clients never send amounts: `create-order` recomputes all prices from the DB.
- Payment truth comes exclusively from `mp-webhook` (validates the `x-signature` HMAC timing-safely, re-fetches the payment from MP's API, idempotent transitions). The deep-link result screen only polls the order row; it never marks anything paid.
- Money is always integer cents. `order_items.name`/`unit_price_cents` and `orders.delivery_address` are snapshots so history survives catalog/address changes.
- No password column anywhere — Supabase Auth owns credentials. Never add hardcoded logins.

## Gotchas

- `tailwind.config.js` `content` globs must list every folder that uses `className` (currently `app/` and `views/`). A folder rename silently drops styles (classes like `category-tile` live in `app/global.css` and are tree-shaken by usage).
- Typed routes (`.expo/types/router.d.ts`) regenerate only when the dev server runs; after adding/renaming routes, `tsc` fails until `npx expo start` has run once.
- After renaming/moving directories, restart Metro with `--clear` — the running graph keeps stale references and 500s with "Got unexpected undefined".
- The delivery fee/threshold constants are intentionally duplicated in `models/delivery.ts` (display) and `supabase/functions/create-order/index.ts` (authoritative) — change both together.
- Windows: source files are UTF-8 without BOM. Do not bulk-edit them with PowerShell 5.1 `Get-Content`/`Set-Content` (default ANSI decoding corrupts accented Spanish text); use Node scripts for mass rewrites.
- Multiple stray Metro processes on this machine have caused phantom "old app" bugs; before debugging stale-bundle symptoms, check `Get-NetTCPConnection -State Listen` for extra node listeners and kill them.
