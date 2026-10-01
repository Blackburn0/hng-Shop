# Coffee Shop — Build Plan

A small online coffee shop. Customers browse coffee and pastries, add items to a cart, sign in with Google, pay with Paystack (test mode) or choose cash on delivery, and get a confirmation email from Mailgun. Everything is stored in Supabase.

> Status key: `[ ]` to do · `[~]` in progress · `[x]` done · **(you)** = a step you do yourself in a dashboard

---

## 0. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Currency | ✅ **NGN (₦)**. Prices are stored as integer kobo (for example, ₦4,500.00 is stored as `450000`). The "RM" in the designs becomes ₦. |
| D2 | "Pay By" options | ✅ **Visa → Paystack checkout** (card, bank transfer, USSD). **Cash → cash on delivery.** The Touch 'n Go button is removed. |
| D3 | Delivery details | Default: a small **Delivery details** card (name, phone, address) on the checkout page, styled like the "Pay By" card. |
| D4 | When to sign in | Default: anyone can browse and use the cart; **Google sign-in is required at checkout**. |
| D5 | Fonts | Default: **Jost** (like Futura), **Nunito Sans** (like Avenir) and **Nothing You Could Do** (script logo). |
| D6 | Database | ✅ **One Supabase project, `hng-shop`, used for both the app and the tests.** It's a test project with no real customers. Tests create their own rows, tagged so they can be found, and delete them afterwards. They never empty whole tables. |
| D7 | Order confirmation page | ✅ No design exists, so I'll design `/orders/[id]` in the existing style: espresso-brown card, pill buttons, script logo. |

---

## 1. What the designs contain

| File in `Design/` | What it is | Page it becomes |
| --- | --- | --- |
| `Home Page.png` | Hero ("Discover New Flavours") with a "Shop All Products" button | `/` |
| `Product Page.png` | A list of products: image, name, description, price, "Add to Cart" | `/products` |
| `Confirmation Page.png` | **The shopping cart with the "Pay By" panel.** This is the checkout page. | `/checkout` |
| `Loading Page.png` | "One Step Closer to Your Doorstep" with a spinner | `/checkout/processing`, shown while the payment is checked |
| `loader.svg`, `button_*.svg`, `button_ add to cart.pdf` | Spinner and button styles | Rebuilt in CSS/SVG. Figma's purple dashed frame is removed. |
| *(missing)* | The order confirmation page | `/orders/[id]`, designed by me in the existing style (D7) |

**Design tokens** (taken from the SVGs and screenshots):

- Espresso brown `#351C0F` for the header, footer, "Pay By" card, button outlines and text
- Pill grey `#E8E8E8` for the footer buttons
- Page background `#FFFFFF`; text `#000000`
- Radii: pill buttons fully rounded; product images about 40px on one corner; cards about 32px
- Small fixes: rename the cart column "Quality" to **"Quantity"**; the cart's "Croissant" row uses the Yule Log image, so each item will use its own product image

---

## 2. Tech stack

| Concern | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router) + **TypeScript**, Node 24 |
| Styling | **Tailwind CSS v4**, with the design tokens in `src/app/globals.css` |
| Database | **Supabase Postgres**, with versioned SQL migrations in `supabase/migrations/` |
| Auth | **Supabase Auth → Google provider**, using the OAuth client from Google Cloud Console |
| Payments | **Paystack** test mode: server-side `transaction/initialize` → redirect to Paystack → verify the payment and handle the webhook |
| Email | **Mailgun** HTTP API, using the sandbox domain while testing |
| Validation | **Zod** for every request body, query string and environment variable |
| Tests | **Vitest** calling the route handlers with real `Request` objects, against the `hng-shop` database (D6). **MSW** stands in for Paystack and Mailgun. |

**Packages to install.** These are waiting for your approval; see §7.

- runtime: `next react react-dom @supabase/supabase-js @supabase/ssr zod mailgun.js form-data`
- dev: `typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next vitest @vitest/coverage-v8 msw supabase`

---

## 3. Architecture

```
Browser ──► Next.js pages (Server Components)
   │            │
   │            ├─► /api/v1/*  route handlers ──► Supabase (Postgres + Auth)
   │            │                    │
   │            │                    ├─► Paystack  (initialize / verify)
   │            │                    └─► Mailgun   (order confirmation)
   │
   └─► Paystack checkout ──redirect──► /checkout/processing?reference=…
                          ──webhook──► /api/v1/payments/paystack/webhook
```

**Rules that keep payments safe**

- **The server calculates prices.** The browser only sends `{productId, quantity}`, and totals are worked out from the `products` table.
- **Payments are confirmed on the server.** An order is marked `paid` only after Paystack's `verify` call or a webhook with a valid signature (`x-paystack-signature`, HMAC-SHA512 with the secret key).
- **Nothing happens twice.** The webhook and the verify callback can both arrive. Payment events are stored with a unique key, and each order's confirmation email is recorded with a unique `(order_id, type)`, so a paid order is never processed twice and never gets two emails.
- The service-role key and the Paystack and Mailgun secrets are used **only on the server**. Nothing prefixed `NEXT_PUBLIC_` is secret.

### Pages

| Route | Design | Notes |
| --- | --- | --- |
| `/` | Home | Hero + "Shop All Products" button |
| `/products` | Product | Server-rendered from the `products` table; "Add to Cart" updates the cart |
| `/checkout` | Cart + Pay By | Quantity −/+, remove item, total, delivery details (D3), Pay By buttons, "Back to Order". Google sign-in is required before paying. |
| `/checkout/processing` | Loading | Checks the Paystack reference, then redirects to the order page |
| `/orders/[id]` | *(new)* | Order summary; visible only to its owner |
| `/auth/callback` | — | Supabase's OAuth code exchange |
| `/health` → `/api/health` | — | Liveness check (the rewrite is set up in `next.config.ts`) |

### API endpoints (`/api/v1`, errors as RFC 9457 `application/problem+json`)

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | public | Liveness check |
| `GET /api/ready` | public | Checks that the database can be reached |
| `GET /api/v1/products` | public | List active products (cursor pagination, `?limit=` 1–100, default 20) |
| `GET /api/v1/products/{slug}` | public | One product |
| `GET /api/v1/cart` | user | The signed-in user's cart |
| `PUT /api/v1/cart/items/{productId}` | user | Set an item's quantity (1–99); idempotent |
| `DELETE /api/v1/cart/items/{productId}` | user | Remove an item → `204` |
| `POST /api/v1/cart/merge` | user | Merge the guest (localStorage) cart after sign-in |
| `POST /api/v1/orders` | user | Create an order from the cart. `card` → returns `authorizationUrl`; `cash` → order confirmed and email sent. Returns `201` + `Location`. |
| `GET /api/v1/orders` | user | The signed-in user's orders (cursor pagination) |
| `GET /api/v1/orders/{id}` | owner | One order; someone else's order returns `404` |
| `GET /api/v1/payments/paystack/verify?reference=` | owner | Called by the processing page. Verifies the payment with Paystack and marks the order paid. Idempotent. |
| `POST /api/v1/payments/paystack/webhook` | signature | Handles `charge.success`. Returns `401` on a bad signature. Idempotent. |

---

## 4. Database schema (first migration)

```
profiles        id (= auth.users.id) · email · full_name · avatar_url · created_at
                  ↳ created automatically by a trigger when someone signs in for the first time
products        id uuid · slug unique · name · description · category (coffee|pastry)
                · price_minor int · currency char(3) · image_url · is_active · created_at · updated_at
cart_items      user_id · product_id · quantity (1–99) · updated_at      PK (user_id, product_id)
orders          id uuid · user_id · status (pending_payment|paid|failed|cancelled|cash_on_delivery)
                · payment_method (card|cash) · subtotal_minor · total_minor · currency
                · customer_email · delivery_name · delivery_phone · delivery_address
                · paystack_reference unique · paid_at · created_at · updated_at
order_items     id · order_id · product_id · product_name (snapshot) · unit_price_minor
                · quantity · line_total_minor
payment_events  id · provider · event_id unique · event_type · reference · payload jsonb · received_at
email_log       id · order_id · type · provider_message_id · status · created_at   UNIQUE (order_id, type)
```

- **Row Level Security** is on for every table. `products` can be read by anyone. Users can read and write only their own `cart_items`, and read only their own `orders` and `order_items`. Writes to orders, payments and emails go through the server using the service role.
- Every migration has a matching **down** script in `supabase/rollbacks/`. It's kept outside `migrations/` so the CLI never applies it by mistake.
- The products are added by a migration (`…_seed_products.sql`), so `db push` loads them and running it again is safe. There are three products from the design (Americano ₦3,500, Cappuccino ₦4,200, Yule Log Cake ₦5,500), with images cut from the design into `public/products/`.

---

## 5. Phases

### Phase 1 — Scaffold ✅ (this change)
- [x] Branch `feat/scaffold`
- [x] `plan.md`, `.gitignore`, `.env.example`, `.nvmrc`, `README.md`
- [x] `package.json` scripts, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`
- [x] App skeleton: `layout.tsx` (fonts + tokens), placeholder home page, `GET /api/health`, validated env loader
- [x] Folders: `src/lib`, `src/components`, `supabase/migrations`, `tests/`, `docs/openapi.yaml`
- [x] Packages installed (Next 16.3, React 19.3, Tailwind 4.3, Zod 4, Vitest 5, Supabase CLI 2.118)
- [x] `npm run dev` starts, `/health` returns 200, and lint, typecheck and tests pass

### Phase 2 — Database
- [x] Write the migration (tables, enums, RLS, profile trigger) and its down script
- [x] Write the product seed migration and add the product images
- [x] Test up, down and up again, plus the constraints and RLS, on an in-memory Postgres (PGlite) with stand-ins for Supabase's auth: 26/26 checks pass
- [x] **(you)** Applied both migrations in the SQL Editor and recorded them in `supabase_migrations.schema_migrations`
- [x] Checked from the app: anon can read the 3 products, and anon is refused on `orders`
- [x] TypeScript types in `src/lib/database.types.ts`, written by hand to match the schema. `npm run db:types` can regenerate them after `supabase link`.

### Phase 3 — Layout and static pages
- [x] Header (logo, Products, Checkout with a cart count) and footer (logo, tagline, three pill buttons, ©). The sign-in / avatar button comes in Phase 5.
- [x] Home hero, pill buttons, spinner component rebuilt from `loader.svg`
- [x] Responsive layouts, checked at 1440px, about 630px and 375px
- [x] Hero photo: your export, converted to `public/hero.jpg` (1440×880, 285 KB)

### Phase 4 — Products and cart
- [x] `GET /api/v1/products` (cursor pagination, `?category=`) and `GET /api/v1/products/{slug}`, with tests
- [x] `/products` page (the footer's "our Coffee" / "our Pastry" filter it by category)
- [x] Guest cart in localStorage (`src/lib/guest-cart.ts`) + Add to Cart button + header count
- [x] Cart API: `GET /cart`, `PUT` and `DELETE /cart/items/{id}`, `POST /cart/merge` (Bearer token or session cookie), with tests
- [x] `GET /api/ready` checks the database
- [x] Full test suite against `hng-shop`: 77/77 pass, 88.7% line and 86.8% branch coverage. Cleanup leaves no test users, products or cart rows behind.
- [x] Checked on the running server with a temporary user: GET, PUT, DELETE and merge, each with success and failure cases
- [x] After sign-in the header and Add to Cart use the database cart (`CartProvider`), and the guest cart is merged in, then cleared

### Phase 5 — Google sign-in
- [x] Sign-in handled on the server, with no Supabase code in the browser:
  - `GET /auth/login?next=` starts Google sign-in (PKCE)
  - `GET /auth/callback` swaps the code for a session cookie
  - `POST /auth/signout` refuses requests from other sites with 403
- [x] `src/proxy.ts` (Next 16's name for middleware) refreshes the session on every request. `getCurrentUser()` is available to Server Components.
- [x] Header: "Sign in", or the user's Google photo with a menu to sign out. On screens under 400px these show as icons.
- [x] `/login` page with a friendly message for each error. `?next=` only accepts paths on this site, so it can't redirect anywhere else.
- [x] 24 auth tests. The full suite is 101/101, with 85.7% line and 87.6% branch coverage.
- [x] Checked on the running server: login gives a 303 to Supabase's authorize URL, and the callback and sign-out error paths all work
- [x] **(you)** Google Cloud client created, app published, and the Google provider turned on in Supabase
- [x] Real Google sign-in checked: the user and profile (name + photo) were created by the trigger, and the guest cart merged into the database
- [x] Checkout and orders require sign-in (built in Phase 6)

### Phase 6 — Checkout and Paystack
- [x] Migration `…150000_order_functions.sql`, with a rollback:
  - `create_order` prices the cart and writes the order and its items in one transaction
  - `mark_order_paid` is safe to call twice: only the first call counts, it checks the amount and currency, and it removes only the bought items from the cart
  - only the server (service role) can call them
  - PGlite: 22/22 checks pass
- [x] `/checkout` matches the design: cart table, −/+ quantity, remove, total, "Pay By" (Visa → Paystack, Cash → cash on delivery) and "< Back to Order". Plus a Delivery details form (D3). Signed-out visitors see "Sign in with Google".
- [x] API:
  - `POST /api/v1/orders` (card or cash), `GET /api/v1/orders`, `GET /api/v1/orders/{id}`
  - `GET /api/v1/payments/paystack/verify`
  - `POST /api/v1/payments/paystack/webhook`: checks the HMAC signature, 64 KB body limit, each event recorded once
- [x] `/checkout/processing` (the Loading design) checks the payment every 2.5 seconds for up to about 30 seconds, then goes to `/orders/[id]`
- [x] `/orders/[id]` confirmation page, designed in the site's style (D7)
- [x] 49 new tests in `orders.test.ts` (27) and `payments.test.ts` (22), with MSW standing in for Paystack. They cover:
  - 401, 400, 404-for-other-users, 409 (empty cart, amount mismatch), 413, 422 including price tampering, 502
  - a duplicate webhook, and verify racing the webhook (the order is marked paid exactly once)
- [x] `docs/openapi.yaml` updated to v0.3.0
- [x] **(you)** Ran `20260930150000_order_functions.sql` in the SQL Editor (both functions confirmed with `pg_proc`)
- [x] **(you)** Paystack test secret key in `.env.local`
- [x] Full suite against `hng-shop`: 151/151 pass, 89.0% line and 87.5% branch coverage, no leftover test data
- [x] End to end by hand (you): a cash order (₦4,200, pay on delivery) and a card payment in Paystack test mode (₦3,500, "Success") → Loading page → Paid
- [ ] Webhook on localhost: needs a public tunnel, so it's optional. The verify endpoint already confirms payments. The real webhook gets tested after the Vercel deploy (Phase 9).

### Phase 7 — Mailgun emails
- [x] Order confirmation email (`src/lib/email/`): HTML laid out with tables and inline styles plus a plain-text version, brand colours, items, total, delivery details, a "View your order" link. Customer-entered text is HTML-escaped.
- [x] Sent when a cash order is placed, or when a card order first becomes paid (by verify or by the webhook). `email_log` lets only one sender claim each order, so racing calls send exactly one email, and a failed send can be retried.
- [x] If Mailgun is down, the order still succeeds. The failure is stored with the HTTP status and Mailgun's reason, with email addresses blanked out.
- [x] Order page: "A confirmation has been sent…" only shows once that's true. Otherwise it shows "We're sending…" or "We couldn't email…".
- [x] Tests: 15 email tests with MSW standing in for Mailgun. Any unmatched Paystack or Mailgun request fails, so tests can never reach the real services. Full suite 166/166, 90.0% line and 86.6% branch coverage. The email code: 97% line, 80% branch.
- [x] Checked on the running server with the real Mailgun key: an order for an unauthorised `@example.com` address got 201, and the email was recorded as `failed`: "Mailgun 403 … add the address to your authorized recipients". So the key and domain are valid. A wrong key gets 401.
- [x] **(you)** Your address added as an authorised recipient in the Mailgun sandbox
- [x] **(you)** Real email received for cash order #D1A6880B (landed in Gmail spam: expected for an unauthenticated sandbox domain). Fixed the phone number Gmail had hidden on the brown card.

### Phase 8 — Hardening and handover
- [x] Structured JSON logs (`src/lib/log.ts`), one line per entry, each tagged with the request ID and the W3C `traceparent` trace ID. Emails, phone numbers, addresses, names, tokens and keys are blanked out, and errors are logged without stack traces. `LOG_LEVEL` controls how much is logged.
- [x] `X-Request-Id` on every page and API response. A valid incoming ID is kept, anything else is replaced, and `src/proxy.ts` forwards the ID to the handler.
- [x] `route()` wrapper (`src/lib/http/route.ts`) on all 14 route files. It writes the access log line, turns unhandled errors into a 500 with no internal details, and handles the next two items.
- [x] Rate limiting kept in memory, per IP (your choice). Over the limit: 429, `Retry-After`, and `RateLimit-*` headers. Limits: products 120/min, cart/orders/verify 60/min, placing orders 10/min, sign-in 20/min. Webhook and health checks have no limit.
- [x] Body size limits: 413 over 16 KB (the webhook allows 64 KB). Checked from `Content-Length` and again while reading the body.
- [x] `docs/openapi.yaml` v0.4.0: every endpoint, 429 and 413 responses, request ID and rate-limit headers. Checked that it parses and every `$ref` resolves.
- [ ] Automatically check API responses against the OpenAPI schema in the tests. This needs a validator package (new dependency, needs approval); optional.
- [x] Full suite: 209/209 pass, 91.5% line and 87.9% branch coverage. New code in `src/lib/http`: 98.8% line, 98.1% branch. Lint, typecheck and `npm run build` pass.
- [x] Tested against the running server:
  - `X-Request-Id` generated, kept or replaced as expected; the JSON log line carries `requestId` and `traceId`
  - 120 requests got 400, then 429 with `Retry-After: 46`; a different IP was unaffected
  - 20 KB PUT → 413; 70 KB webhook → 413
- [x] Merged into `main` locally (fast-forward, all 8 phase commits). Scanned the whole git history for secrets: only `.env.example` was ever committed. Commit author switched to the GitHub no-reply address before the first push. Pushed to https://github.com/Blackburn0/hng-Shop (public). From now on, changes go to `main` through PRs.

### Phase 9 — Deploy to Vercel ✅
Live at **https://hng-shop-oztn.vercel.app**. Every push to `main` redeploys automatically.
- [x] **(you)** Vercel project `hng-shop-oztn` imported from GitHub
- [x] **(you)** 10 environment variables added (Production and Preview):
  - The three `NEXT_PUBLIC_*` values are stored as **Config**. They're built into the browser bundle on purpose.
  - Keys (service role, Paystack, Mailgun) are stored as **Secret**.
  - `NEXT_PUBLIC_SITE_URL=https://hng-shop-oztn.vercel.app`. (`hng-shop.vercel.app` belongs to another project.)
- [x] **(you)** Google Cloud: Authorized JavaScript origin `https://hng-shop-oztn.vercel.app`
- [x] **(you)** Supabase: Redirect URL `https://hng-shop-oztn.vercel.app/**`
- [x] **(you)** Paystack Test Webhook URL `https://hng-shop-oztn.vercel.app/api/v1/payments/paystack/webhook`. The first card payment had no webhook because this box was still empty.
- [x] Checked on the live site:
  - `/health` and `/ready` 200 (database ok); products 200 with rate-limit headers; 404 for an unknown product
  - 401 for the cart and orders when signed out; 401 for a fake webhook signature
  - All pages and images 200; `/orders/…` redirects to sign-in
  - `/auth/login` → Supabase → Google, with the callback on the live address
  - A correctly signed test webhook got 200 and was stored (row deleted afterwards)
- [x] End to end on the live site (you, then checked in the database):
  - Card #E4205FA3: ₦11,000, paid, email sent
  - Cash #0EC525E9: ₦7,000, cash on delivery, email sent
  - Card #9B98F653: ₦4,200, paid. Paystack's `charge.success` webhook arrived 15 s later, and still only one email was sent.

### Phase 10 — Open to everyone with the link
Everything already works for anyone, except emails, which only reach the Mailgun sandbox's authorised recipients.
- [ ] **(you)** Google Auth Platform → **Audience**: confirm it says **In production** (not Testing)
- [ ] **(you)** Supabase → Authentication → URL Configuration → **Site URL**: change `http://localhost:3000` to `https://hng-shop-oztn.vercel.app`
- [ ] **(you)** Verify your own domain in Mailgun, so confirmation emails reach anyone (and land in inboxes, not spam):
  1. Get a domain if you don't have one (Vercel → Domains → Buy, Cloudflare or Namecheap; about $10–15 a year).
  2. Mailgun → **Send → Sending → Domains → Add new domain**: use a subdomain such as `mg.yourname.com`, region **US**.
  3. Add the DNS records Mailgun shows (SPF TXT, DKIM TXT, MX, optional tracking CNAME), plus DMARC: TXT at `_dmarc.mg` with value `v=DMARC1; p=none;`
  4. Mailgun → **Verify DNS settings** (minutes to a few hours). Mailgun may also ask you to confirm your account.
  5. Create a **sending key** for the new domain.
  6. In Vercel and `.env.local`, set `MAILGUN_DOMAIN`, `MAILGUN_FROM="Coffee Shop <orders@mg.yourname.com>"` and `MAILGUN_API_KEY` (the new key). Then **Redeploy**.
- [ ] Send a test to an address outside the old authorised list and confirm delivery (Claude, after the domain is verified)
- [ ] Optional: a Vercel **Firewall** rate-limit rule for a hard limit across all instances (the in-app limit is per instance)

**Free plan limits:**
- Mailgun: about 100 emails a day
- Supabase: pauses after about a week with no activity (resume it from the dashboard; the data is kept)
- Paystack: stays in **test mode** (test cards, no real money). Live payments would need Paystack's compliance steps.

**Optional follow-ups:**
- Check API responses against the OpenAPI schema in the tests (needs a validator package, so approval)
- Remove the unused `form-data` dependency (approval)
- Delete the old local `feat/*` branches (already in `main`)

---

## 6. Setup checklist (you)

- [x] Supabase project `hng-shop` created → URL `https://rnsrxyjvyvyugbplcxbu.supabase.co`
- [x] `.env.local` filled in with real test keys (never committed)
- [x] Supabase → Authentication → Providers → **Google** turned on, with the Client ID and Secret from Google Cloud Console
  - Google redirect URI: `https://rnsrxyjvyvyugbplcxbu.supabase.co/auth/v1/callback`
  - Redirect URLs: `http://localhost:3000/**` and `https://hng-shop-oztn.vercel.app/**`
- [x] **Paystack**: test secret key in `.env.local` and Vercel; Test Webhook URL set to the live site
- [x] **Mailgun**: sandbox domain, sending key and authorised recipient set. A domain of your own is still to do (Phase 10).

---

## 7. Waiting on you

1. Phase 10: confirm Google is **In production**, change the Supabase **Site URL**, and verify a domain in Mailgun
2. Review and merge the PR for this plan update
