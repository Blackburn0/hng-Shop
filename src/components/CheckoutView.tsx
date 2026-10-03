"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/components/CartProvider";
import { pillOutline } from "@/components/ui";
import { MAX_QUANTITY } from "@/lib/cart";
import { formatMoney } from "@/lib/money";

type FieldErrors = Partial<Record<"name" | "phone" | "address", string>>;
type Status = { kind: "idle" } | { kind: "submitting"; method: "card" | "cash" } | { kind: "error"; message: string };

const input =
  "mt-1 w-full rounded-2xl border-2 border-espresso/40 bg-paper px-4 py-3 text-lg outline-none " +
  "focus:border-espresso aria-invalid:border-red-700";
const payButtonBase =
  "flex h-[4.3rem] w-full items-center justify-center rounded-[1.25rem] transition " +
  "hover:ring-4 hover:ring-paper/40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-paper " +
  "disabled:cursor-wait disabled:opacity-70";
const payButton = `${payButtonBase} bg-paper`;
// Paystack's own navy (#011B33, the background of public/pay-paystack.png) so the logo sits seamlessly.
const paystackButton = `${payButtonBase} bg-[#011B33]`;

export function CheckoutView({ signedIn, defaultName }: { signedIn: boolean; defaultName: string }) {
  const cart = useCart();
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const busy = status.kind === "submitting";

  async function submit(method: "card" | "cash", form: HTMLFormElement) {
    const data = new FormData(form);
    setErrors({});
    setStatus({ kind: "submitting", method });
    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: method,
          delivery: { name: data.get("name"), phone: data.get("phone"), address: data.get("address") },
        }),
      });
      const body = await res.json();
      if (res.status === 201) {
        if (method === "card") {
          window.location.assign(body.next); // Paystack checkout
          return;
        }
        await cart.refresh();
        router.push(body.next);
        return;
      }
      if (res.status === 422 && Array.isArray(body.errors)) {
        const fieldErrors: FieldErrors = {};
        for (const e of body.errors as { field: string; message: string }[]) {
          const key = e.field.replace(/^delivery\./, "") as keyof FieldErrors;
          fieldErrors[key] ??= `${label(key)} ${e.message}`;
        }
        setErrors(fieldErrors);
        setStatus({ kind: "idle" });
        return;
      }
      if (res.status === 401) {
        // Full navigation: /auth/login redirects off-site to Google.
        window.location.assign(new URL("/auth/login?next=%2Fcheckout", window.location.origin).href);
        return;
      }
      setStatus({ kind: "error", message: body.detail ?? "Something went wrong. Please try again." });
      if (res.status === 409) await cart.refresh();
    } catch {
      setStatus({ kind: "error", message: "We couldn't reach the shop. Check your connection and try again." });
    }
  }

  if (!cart.ready) {
    return (
      <section className="mx-auto max-w-[1440px] px-4 py-24 text-center text-xl sm:px-8 md:px-14" aria-busy="true">
        Loading your cart…
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[1440px] px-4 pb-16 pt-10 sm:px-8 md:px-14 md:pb-20 md:pt-12">
      <h1 className="font-body text-4xl font-extrabold md:text-[4rem] md:leading-none">Shopping Cart</h1>

      {cart.items.length === 0 ? (
        <div className="mt-12 flex flex-col items-start gap-8">
          <p className="text-xl">Your cart is empty.</p>
          <Link href="/products" className={`${pillOutline} h-14 text-xl md:text-2xl`}>
            <span aria-hidden="true">&lt;</span> Back to Order
          </Link>
        </div>
      ) : (
        <form
          id="checkout"
          className="mt-8 grid gap-12 lg:mt-10 lg:grid-cols-[minmax(0,954px)_324px] lg:justify-between lg:gap-12"
          onSubmit={(e) => {
            e.preventDefault();
            const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            void submit(submitter?.value === "cash" ? "cash" : "card", e.currentTarget);
          }}
          noValidate
        >
          <div>
            {/* Cart table */}
            <div role="table" aria-label="Cart items">
              <div
                role="row"
                className="hidden grid-cols-[minmax(0,367px)_275px_1fr_40px] border-b-[1.5px] border-ink pb-2 font-body text-3xl font-extrabold md:grid"
              >
                <span role="columnheader">Product</span>
                <span role="columnheader">Quantity</span>
                <span role="columnheader">Total Price</span>
                <span role="columnheader" className="sr-only">
                  Remove
                </span>
              </div>

              {cart.items.map((item) => (
                <div
                  role="row"
                  key={item.productId}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-4 border-b-[1.5px] border-ink py-5 md:grid-cols-[minmax(0,367px)_275px_1fr_40px] md:gap-0 md:py-6"
                >
                  <div role="cell" className="flex min-w-0 items-center gap-4 md:gap-10">
                    <Image
                      src={item.imageUrl}
                      alt=""
                      width={117}
                      height={114}
                      className="size-16 shrink-0 object-cover sm:size-20 md:h-[114px] md:w-[117px]"
                    />
                    <span className="font-body text-xl font-extrabold sm:text-2xl md:text-[2rem]">{item.name}</span>
                  </div>

                  <div role="cell" className="row-start-2 md:row-start-auto">
                    <div className="inline-flex h-11 items-center rounded-full border-[1.5px] border-ink md:h-[3.75rem]">
                      <button
                        type="button"
                        className="h-full w-10 rounded-l-full text-3xl leading-none hover:bg-pill disabled:opacity-40 md:w-14"
                        onClick={() => void cart.setQuantity(item.productId, item.quantity - 1)}
                        disabled={item.quantity <= 1 || busy}
                        aria-label={`Decrease ${item.name} quantity`}
                      >
                        -
                      </button>
                      <span className="w-10 text-center text-xl tabular-nums md:w-16 md:text-[2rem]" aria-live="polite">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        className="h-full w-10 rounded-r-full text-3xl leading-none hover:bg-pill disabled:opacity-40 md:w-14"
                        onClick={() => void cart.setQuantity(item.productId, item.quantity + 1)}
                        disabled={item.quantity >= MAX_QUANTITY || busy}
                        aria-label={`Increase ${item.name} quantity`}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div role="cell" className="row-start-2 justify-self-end text-xl tabular-nums sm:text-2xl md:row-start-auto md:justify-self-start md:text-[2rem]">
                    {formatMoney(item.unitPriceMinor * item.quantity)}
                  </div>

                  <div role="cell" className="col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto">
                    <button
                      type="button"
                      onClick={() => void cart.remove(item.productId)}
                      disabled={busy}
                      className="grid size-10 place-items-center rounded-full text-ink/60 hover:bg-pill hover:text-ink"
                      aria-label={`Remove ${item.name}`}
                    >
                      <svg viewBox="0 0 24 24" className="size-7" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="M4 4l16 16M20 4L4 20" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex items-baseline justify-end gap-6 pt-8 md:grid md:grid-cols-[minmax(0,367px)_275px_1fr_40px] md:gap-0">
                <span className="font-body text-2xl font-extrabold sm:text-3xl md:col-start-2 md:justify-self-end md:pr-28">Total:</span>
                <span className="text-2xl tabular-nums sm:text-3xl md:text-[2rem]">{formatMoney(cart.subtotalMinor)}</span>
              </div>
            </div>

            {/* Delivery details (not in the Figma file — plan.md D3) */}
            {signedIn && (
              <fieldset className="mt-12 max-w-2xl" disabled={busy}>
                <legend className="font-body text-3xl font-extrabold">Delivery details</legend>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field name="name" label="Full name" autoComplete="name" defaultValue={defaultName} error={errors.name} />
                  <Field name="phone" label="Phone" autoComplete="tel" inputMode="tel" error={errors.phone} />
                  <div className="sm:col-span-2">
                    <Field name="address" label="Delivery address" autoComplete="street-address" error={errors.address} multiline />
                  </div>
                </div>
              </fieldset>
            )}

            <Link href="/products" className={`${pillOutline} mt-10 h-14 w-full text-xl sm:w-auto sm:min-w-80 md:text-2xl`}>
              <span aria-hidden="true">&lt;</span> Back to Order
            </Link>
          </div>

          {/* Pay By */}
          <aside className="h-fit rounded-[2.5rem] bg-espresso px-9 pb-10 pt-8 text-paper lg:mt-[5.5rem]">
            <h2 className="text-center font-body text-5xl font-extrabold">Pay By</h2>

            {signedIn ? (
              <div className="mt-11 flex flex-col gap-9">
                <button type="submit" name="paymentMethod" value="card" className={paystackButton} disabled={busy}>
                  {status.kind === "submitting" && status.method === "card" ? (
                    <span className="text-lg font-bold text-paper">Opening Paystack…</span>
                  ) : (
                    <>
                      <Image src="/pay-paystack.png" alt="" width={97} height={62} />
                      <span className="sr-only">Pay with Paystack (card, bank transfer or USSD)</span>
                    </>
                  )}
                </button>
                <button type="submit" name="paymentMethod" value="cash" className={payButton} disabled={busy}>
                  {status.kind === "submitting" && status.method === "cash" ? (
                    <span className="text-lg font-bold text-espresso">Placing order…</span>
                  ) : (
                    <>
                      <Image src="/pay-cash.png" alt="" width={127} height={43} />
                      <span className="sr-only">Pay cash on delivery</span>
                    </>
                  )}
                </button>
                <p className="text-center text-sm text-paper/80">Card payments are processed securely by Paystack.</p>
              </div>
            ) : (
              <div className="mt-8 text-center">
                <p className="text-lg">Sign in to choose how to pay.</p>
                <a
                  href="/auth/login?next=%2Fcheckout"
                  className={`${payButton} mt-6 text-lg font-bold text-espresso`}
                >
                  Sign in with Google
                </a>
              </div>
            )}

            {status.kind === "error" && (
              <p role="alert" className="mt-6 rounded-2xl bg-paper/15 px-4 py-3 text-center">
                {status.message}
              </p>
            )}
          </aside>
        </form>
      )}
    </section>
  );
}

function label(key: keyof FieldErrors) {
  return { name: "Name", phone: "Phone", address: "Address" }[key] ?? "This field";
}

function Field({
  name,
  label: text,
  error,
  multiline,
  ...rest
}: {
  name: string;
  label: string;
  error?: string;
  multiline?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `delivery-${name}`;
  const common = { id, name, required: true, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined };
  return (
    <label htmlFor={id} className="block text-lg">
      {text}
      {multiline ? (
        <textarea {...common} rows={3} autoComplete={rest.autoComplete} className={input} />
      ) : (
        <input {...common} {...rest} className={input} />
      )}
      {error && (
        <span id={`${id}-error`} className="mt-1 block text-base text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}
