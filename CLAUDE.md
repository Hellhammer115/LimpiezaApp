# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LimpiezaApp: a production-targeted grocery/cleaning-products delivery app (Calii-style, Mexico, MXN, Spanish UI) built with Expo SDK 57 + React Native + expo-router + NativeWind, Supabase (Postgres/Auth/Edge Functions) and a quote-first checkout (cotizaciones) paid through Mercado Pago Checkout Pro once an admin sends the quote. Repo work happens on `feature/limpiezaapp-production` (open PR #2 against `master`; PR #1 was merged in July).

## Commands

```sh
npx expo start --port 8081        # dev server; add --offline if api.expo.dev is unreachable
npx tsc --noEmit                  # typecheck (no test suite exists yet)
npx expo lint                     # ESLint
npx expo-doctor                   # project health

# Supabase (server side)
npx supabase db push                              # apply supabase/migrations
npx supabase functions deploy create-quote        # customer: cart -> cotización
npx supabase functions deploy quote-actions       # customer: pay / cancel a cotización
npx supabase functions deploy admin-orders        # admin: list / create / edit / send / reject / advance
npx supabase functions deploy admin-users         # admin: customer lookup for admin-created quotes
npx supabase functions deploy mp-webhook --no-verify-jwt   # MP calls it without a JWT; it validates x-signature instead
```

The CLI is not always linked on this machine; the Supabase MCP tools (`apply_migration`, `deploy_edge_function` with the `_shared/*.ts` files bundled alongside `index.ts`) do the same job.

App config: copy `.env.example` → `.env`. `EXPO_PUBLIC_DEMO=1` enables demo mode (bundled sample catalog from `models/demoData.ts`, auth bypassed, no backend needed). Real mode needs `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Server secrets (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `RESEND_API_KEY`, `QUOTES_FROM_EMAIL`) live only in `supabase secrets`, never in `.env`; without the Resend pair, quote emails are skipped with a log line.

## Architecture (MVC)

Strict layering — views never import Supabase or models directly; the flow is always view → controller → model:

- `models/` — data access + domain rules. All Supabase queries live here (`catalogModel`, `orderModel`, `profileModel`, `addressModel`, `authModel`, `paymentModel`, `quoteModel`, `adminModel`, `adminOrderModel`), plus the persisted zustand cart (`cartStore`), demo data, `delivery.ts` (display mirror of the fee rule), `orderStatus.ts` (status labels/predicates and `computeTotals`, the client mirror of the `apply_quote_edit` SQL formula), `quoteDocument.ts` (pure HTML for the PDF export), `adminOrderModel.ts` (`lookupCustomers`, `createQuoteForCustomer` among the admin actions), `quoteModel.ts` (`acceptQuote`) and `functionError.ts` (surfaces an Edge Function's Spanish `error` message).
- `controllers/` — hooks consumed by views: TanStack Query wrappers (`useCatalog`, `useOrders`, `useProfile`, `useAddresses`, `useAdminOrders`), session context (`useAuth` — `AuthProvider` mounts at root), cart selectors (`useCart`: prefer the primitive selectors `useInCart`/`useCartCount`/`useCartSubtotal` to avoid grid-wide re-renders), `useCheckout` (requests a cotización, no payment), `useQuote` (customer pay/cancel) and `useQuotePdf` (expo-print + expo-sharing).
- `views/` — reusable UI components; `app/` — routed screens (expo-router requires them there; they are thin views).
- `services/supabase.ts` — the client. Session storage is platform-dependent: AES-encrypted (key in Keychain/Keystore) on native, localStorage on web browser, DISABLED during SSR — Expo's static web output executes this module in Node where `window` doesn't exist, and touching storage there crashes the dev server.
- `supabase/functions/` — **Deno** code (`Deno.serve`, `npm:` imports). Excluded from the app tsconfig; VS Code uses the Deno extension scoped via `.vscode/settings.json`. Don't "fix" its imports to Node style.

Routing: `app/(auth)` (sign-in/up) and `app/(protected)` (everything else) are guarded by their `_layout.tsx` files using `useAuth` + `DEMO_MODE`. In demo mode the auth group redirects to home.

## Security invariants (do not weaken)

- RLS on every table; catalog is client-read-only; `orders`/`order_items` are written ONLY by Edge Functions with the service role (admins additionally get `select` on every order). A cotización is an `orders` row with `paid_at IS NULL`. "Deleting" a cancelled quote only sets `hidden_by_customer_at` / `hidden_by_admin_at` (each list filters on its own flag); the row is physically removed once both are set. Admin-created quotes (`created_by_admin` set) are inserted by `admin-orders` `create` with `address_id = null` and totals from `apply_quote_edit`; the customer's `accept` action records address/slot and `pay` refuses until then. Clients never send amounts: `create-quote` recomputes all prices from the DB, and admins edit unpaid quotes only through `admin-orders` → `apply_quote_edit` (service-role RPC), which recomputes totals and clears any MP preference. When that edit changes a `quote_sent` row, it also saves the version the customer last saw in `previous_quote` and bumps `quote_updated_at`. The customer must accept the update (`quote-actions` `accept_update`, guarded on the reviewed `quote_updated_at`) and sets `quote_update_accepted_at`; `pay` refuses while an update is pending. `models/quoteRevision.ts` diffs the two versions, and `statusBadge` in `orderStatus.ts` gives each order its single tag (Cotización actualizada / aceptada / enviada).
- Payment truth comes exclusively from `mp-webhook` (validates the `x-signature` HMAC timing-safely, re-fetches the payment from MP's API, idempotent transitions). Only it sets `paid`/`paid_at`; a failed payment returns the row to `quote_sent`. `quote-actions` builds the MP preference from the stored quoted total, never from the client. The deep-link result screen only polls the order row; it never marks anything paid.
- Money is always integer cents. `order_items.name`/`unit_price_cents` and `orders.delivery_address` are snapshots so history survives catalog/address changes.
- No password column anywhere — Supabase Auth owns credentials. Never add hardcoded logins.

## Gotchas

- `tailwind.config.js` `content` globs must list every folder that uses `className` (currently `app/` and `views/`). A folder rename silently drops styles (classes like `category-tile` live in `app/global.css` and are tree-shaken by usage).
- Typed routes (`.expo/types/router.d.ts`) regenerate only when the dev server runs; after adding/renaming routes, `tsc` fails until `npx expo start` has run once.
- After renaming/moving directories, restart Metro with `--clear` — the running graph keeps stale references and 500s with "Got unexpected undefined".
- The delivery fee/threshold constants are intentionally duplicated in `models/delivery.ts` (display) and `supabase/functions/_shared/delivery.ts` (authoritative, used by `create-quote`) — change both together.
- Postgres cannot use a new enum value inside the migration that adds it — `ALTER TYPE … ADD VALUE` goes in its own migration file (see `20260915022643_quotes_enum.sql`).
- Edge Function shared code lives in `supabase/functions/_shared/` and is imported with relative `../_shared/x.ts` paths; when deploying through the MCP, bundle those files next to the function's `index.ts`.
- `services/supabase.ts` installs `react-native-url-polyfill`, whose `URLSearchParams` has no `size` getter (`params.size` is `undefined`); test emptiness with `params.toString()`.
- The React Compiler lint rule `react-hooks/set-state-in-effect` fails `npx expo lint`; derive state from props/queries instead of syncing it in an effect (see the checkout address selection and the admin order editor).
- Windows: source files are UTF-8 without BOM. Do not bulk-edit them with PowerShell 5.1 `Get-Content`/`Set-Content` (default ANSI decoding corrupts accented Spanish text); use Node scripts for mass rewrites.
- Multiple stray Metro processes on this machine have caused phantom "old app" bugs; before debugging stale-bundle symptoms, check `Get-NetTCPConnection -State Listen` for extra node listeners and kill them.
