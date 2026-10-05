# Coffee Shop — mobile app

Expo (React Native, SDK 57) app for the same shop as the website. It uses the
**same `/api/v1` endpoints** (`docs/openapi.yaml`) and the **same Google sign-in**
(Supabase), so the cart and orders are shared with the website.

**Live cart:** anything added on the website appears in the app's cart within
about a second (and the other way round). Every cart change bumps the user's row
in `public.cart_versions` (with a snapshot of the items); Supabase Realtime
pushes that only to the cart's owner, and the app shows the pushed cart straight
away, re-reading `GET /api/v1/cart` only when it can't (`src/lib/cart-sync.ts`).

## Install the APK

Built with EAS (`eas.json`, profile `preview`); talks to the live website, so no
computer is needed. Download the APK on the phone, allow "install unknown apps"
for the browser if asked, and open **Coffee Shop**.

To build a new one (Expo account `hamzatade`, project `coffee-shop`):

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview   # prints a link to the .apk
```

- `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SUPABASE_URL` come from `eas.json`;
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the EAS `preview` environment
  (`eas env:create`). `.env.local` is git-ignored, so EAS never sees it.
- Supabase → Redirect URLs must include `coffeeshop://**`: the installed app
  returns from Google sign-in to `coffeeshop://auth/callback`.
- The signing keystore is kept by Expo (generated on the first build); later
  builds reuse it, so they install over the previous version.
- If `eas` fails with `ECONNRESET`, the network's IPv6 route to Expo is flaky.
  In PowerShell, `$env:NODE_OPTIONS="--dns-result-order=ipv4first"` first.
- Free builds wait in a queue (the first one waited ~1h50m, then built in ~20 min).

## Run it from source on your Android phone (Expo Go)

1. Install **Expo Go** from the Play Store.
2. On your computer:
   ```bash
   cd mobile
   npm install
   cp .env.example .env.local   # then fill in EXPO_PUBLIC_SUPABASE_ANON_KEY
   npx expo start --tunnel
   ```
3. In Expo Go, tap **Scan QR code** and scan the QR code in the terminal. (The
   tunnel also works when the phone and computer are on different networks.)
4. Supabase → Authentication → URL Configuration → Redirect URLs must include
   `exp://*.exp.direct/**` or `exp://**`, Expo Go's sign-in return address in
   tunnel mode. The Account tab shows the exact one in development.

**Why `--tunnel`:** without it, Expo Go's return address contains your
computer's IP (`exp://192.168.x.x:8081/...`), and Supabase refuses redirects to
raw IP addresses, even when they're listed. Google sign-in then ends on the
website instead of returning to the app. Tunnel addresses
(`exp://<id>.exp.direct/...`) are accepted. `@expo/ngrok` is a dev dependency
here because Expo on Windows doesn't find a globally installed copy.

## Screens

| Tab | What it does |
| --- | --- |
| Shop | Hero + products (`GET /api/v1/products`), Add to Cart |
| Cart | Live cart (`/api/v1/cart`), quantity, remove, delivery details, pay by card (Paystack) or cash |
| Orders | Your orders (`GET /api/v1/orders`), tap for details |
| Account | Google sign-in / sign-out, live-sync status |

Card payments open Paystack's checkout in an in-app browser; Paystack returns to
`/checkout/app-return` (`returnTo: "app"`), and the app confirms the payment with
`GET /api/v1/payments/paystack/verify`.

## Checks

```bash
npx tsc --noEmit                 # typecheck
npx expo-doctor                  # Expo config / dependency check
npx expo export --platform android   # does it bundle?
```

The framework-free modules (`src/lib/api.ts`, `src/lib/money.ts`) are tested
from the repo root (`tests/mobile-api.test.ts`), including a contract test that
runs this API client against the website's real route handlers.
