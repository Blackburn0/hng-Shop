// Typed client for the shop's REST API, the same /api/v1 endpoints the website
// uses (docs/openapi.yaml). Pure TypeScript with no React Native imports, so it
// is unit-tested from the repo root (tests/mobile-api.test.ts).

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: "coffee" | "pastry";
  priceMinor: number;
  currency: string;
  imageUrl: string;
};

export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
};

export type Cart = { items: CartItem[]; itemCount: number; subtotalMinor: number; currency: string };

export type OrderStatus = "pending_payment" | "paid" | "failed" | "cancelled" | "cash_on_delivery";

export type Order = {
  id: string;
  status: OrderStatus;
  paymentMethod: "card" | "cash";
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  customerEmail: string;
  delivery: { name: string; phone: string; address: string };
  paidAt: string | null;
  createdAt: string;
  items: { productId: string | null; productName: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }[];
};

export type Page<T> = { data: T[]; nextCursor: string | null };

export type Delivery = { name: string; phone: string; address: string };

export type CreatedOrder = {
  order: Order;
  payment: { provider: "paystack"; reference: string; authorizationUrl: string } | null;
  next: string;
};

export type PaymentCheck = { status: "paid" | "pending" | "failed"; order: Order };

/** An RFC 9457 problem response from the API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = {
  baseUrl: string;
  /** Current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export function createApi({ baseUrl, getToken, fetchImpl = fetch }: Options) {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiError(0, "Can't reach the shop. Check your internet connection and try again.");
    }

    if (res.status === 204) return undefined as T;
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const problem = (body ?? {}) as { title?: string; detail?: string; errors?: { field: string; message: string }[] };
      throw new ApiError(res.status, problem.detail ?? problem.title ?? `Request failed (${res.status})`, problem.errors ?? []);
    }
    return body as T;
  }

  return {
    products: () => call<Page<Product>>("/api/v1/products?limit=100"),
    cart: () => call<Cart>("/api/v1/cart"),
    setQuantity: (productId: string, quantity: number) =>
      call<Cart>(`/api/v1/cart/items/${encodeURIComponent(productId)}`, { method: "PUT", body: { quantity } }),
    removeItem: (productId: string) =>
      call<void>(`/api/v1/cart/items/${encodeURIComponent(productId)}`, { method: "DELETE" }),
    /** Card payments return to a "go back to the app" page (returnTo: "app"). */
    createOrder: (paymentMethod: "card" | "cash", delivery: Delivery) =>
      call<CreatedOrder>("/api/v1/orders", { method: "POST", body: { paymentMethod, delivery, returnTo: "app" } }),
    orders: (cursor?: string) =>
      call<Page<Order>>(`/api/v1/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
    order: (id: string) => call<Order>(`/api/v1/orders/${encodeURIComponent(id)}`),
    verifyPayment: (reference: string) =>
      call<PaymentCheck>(`/api/v1/payments/paystack/verify?reference=${encodeURIComponent(reference)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
