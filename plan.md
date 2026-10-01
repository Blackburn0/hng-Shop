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
- [ ] Switch the header and checkout to the database cart after sign-in (Phase 5)

### Phase 5 — Google sign-in
- [ ] Supabase SSR clients (browser, server, middleware/proxy session refresh)
- [ ] "Sign in with Google" button, `/auth/callback`, sign-out
- [ ] Checkout and orders routes require sign-in; tests cover 401 and 404-for-others

### Phase 6 — Checkout and Paystack
- [ ] `/checkout` page to match the design (+ delivery card, D3)
- [ ] `POST /api/v1/orders` (card and cash), verify endpoint, webhook with signature check
- [ ] `/checkout/processing` (the loading design) → `/orders/[id]`
- [ ] Tests: success, invalid body (422), empty cart (409), price tampering ignored, bad signature (401), duplicate webhook (processed once)

### Phase 7 — Mailgun emails
- [ ] Order confirmation email (HTML + plain text, brand colours, list of items, total)
- [ ] Sent when an order is marked paid or confirmed as cash on delivery; `email_log` makes sure it's sent only once
- [ ] **(you)** Add your own email address as an authorised recipient in the Mailgun sandbox

### Phase 8 — Hardening and handover
- [ ] Structured JSON logs with `X-Request-Id`, and no secrets or personal data in logs
- [ ] Rate limiting on public endpoints, and limits on request body size
- [ ] Complete `docs/openapi.yaml`; check responses against it in the tests
- [ ] Coverage ≥ 80% · full test suite, lint and typecheck pass
- [ ] Test by hand against the running server with curl: each endpoint's success and failure cases, plus a full Paystack test payment
- [ ] Open a PR from `feat/scaffold` (and later branches) into `main`

---

## 6. Setup checklist (you)

- [x] Supabase project `hng-shop` created → URL `https://rnsrxyjvyvyugbplcxbu.supabase.co`
- [ ] Copy `.env.example` to `.env.local` and fill in the keys. **Don't paste keys into chat.**
- [ ] Supabase → Authentication → Providers → **Google**: paste the Client ID and Secret from Google Cloud Console
  - Google redirect URI: `https://rnsrxyjvyvyugbplcxbu.supabase.co/auth/v1/callback`
  - Supabase Site URL: `http://localhost:3000`; Redirect URLs: `http://localhost:3000/auth/callback`
- [ ] **Paystack**: sign up → Settings → API Keys & Webhooks → copy the **test** secret key
  - Webhook URL: this only works through a public tunnel (for example `cloudflared tunnel --url http://localhost:3000`). Until then, the verify endpoint handles payment confirmation during local testing.
- [ ] **Mailgun**: sign up → copy the sandbox domain and API key → add your inbox as an authorised recipient

---

## 7. Waiting on you

1. ~~Approve installing the packages~~ ✅ approved
2. Replace the PLACEHOLDER values in `.env.local` with your real test keys
3. Push the migrations (Phase 2, the "(you)" step)
