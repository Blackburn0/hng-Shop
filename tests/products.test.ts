import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getProduct } from "@/app/api/v1/products/[slug]/route";
import { GET as listProducts } from "@/app/api/v1/products/route";
import type { Tables } from "@/lib/database.types";
import { cleanup, createTestProduct } from "./helpers/db";
import { expectProblem, params, request } from "./helpers/http";

// Public, read-only endpoints: the 401/403 and 409 categories don't apply.
// Seeded catalogue (migrations/20260930130100_seed_products.sql) is read, never modified.
const SEEDED = ["americano", "cappuccino", "yule-log-cake"];
const PATH = "/api/v1/products";

type Product = { slug: string; category: string; priceMinor: number };
type Page = { data: Product[]; nextCursor: string | null };

async function walk(query: string): Promise<Product[]> {
  const all: Product[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const qs = cursor ? `${query}&cursor=${cursor}` : query;
    const res = await listProducts(request(`${PATH}?${qs}`));
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    all.push(...page.data);
    cursor = page.nextCursor;
    if (!cursor) return all;
  }
  throw new Error("pagination did not terminate");
}

let inactive: Tables<"products">;

beforeAll(async () => {
  inactive = await createTestProduct({ is_active: false });
});
afterAll(cleanup);

describe("GET /api/v1/products", () => {
  it("returns 200 with active products in catalogue order", async () => {
    const res = await listProducts(request(PATH));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Page;
    expect(body).toHaveProperty("nextCursor");
    const slugs = body.data.map((p) => p.slug);
    expect(slugs.filter((s) => SEEDED.includes(s))).toEqual(SEEDED);
  });

  it("returns products in the documented camelCase shape with money in kobo", async () => {
    const body = (await (await listProducts(request(PATH))).json()) as Page;
    const americano = body.data.find((p) => p.slug === "americano");

    expect(americano).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      slug: "americano",
      name: "Americano",
      description: expect.stringContaining("Americano"),
      category: "coffee",
      priceMinor: 350000,
      currency: "NGN",
      imageUrl: "/products/americano.jpg",
    });
  });

  it("paginates with limit and cursor without duplicates or gaps", async () => {
    const first = (await (await listProducts(request(`${PATH}?limit=1`))).json()) as Page;
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));

    const walked = await walk("limit=1");
    const slugs = walked.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.filter((s) => SEEDED.includes(s))).toEqual(SEEDED);

    const everything = (await (await listProducts(request(`${PATH}?limit=100`))).json()) as Page;
    expect(slugs).toEqual(everything.data.map((p) => p.slug));
  });

  it("returns an empty page with a null cursor past the last product", async () => {
    const past = Buffer.from(JSON.stringify({ s: 2_147_483_647, id: "ffffffff-ffff-4fff-bfff-ffffffffffff" })).toString(
      "base64url",
    );
    const res = await listProducts(request(`${PATH}?cursor=${past}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], nextCursor: null });
  });

  it("accepts the limit bounds 1 and 100", async () => {
    expect((await listProducts(request(`${PATH}?limit=1`))).status).toBe(200);
    expect((await listProducts(request(`${PATH}?limit=100`))).status).toBe(200);
  });

  it("filters by category", async () => {
    const pastries = await walk("category=pastry");

    expect(pastries.map((p) => p.slug)).toContain("yule-log-cake");
    expect(pastries.every((p) => p.category === "pastry")).toBe(true);
  });

  it("never lists inactive products", async () => {
    const slugs = (await walk("limit=100")).map((p) => p.slug);

    expect(slugs).not.toContain(inactive.slug);
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["limit=abc", "limit"],
    ["limit=1.5", "limit"],
    ["cursor=not-a-cursor", "cursor"],
    [`cursor=${Buffer.from('{"s":"x"}').toString("base64url")}`, "cursor"],
    ["category=tea", "category"],
  ])("returns 400 problem details for invalid query %s", async (qs, field) => {
    const body = await expectProblem(await listProducts(request(`${PATH}?${qs}`)), 400, PATH);

    expect(body.errors?.map((e) => e.field)).toContain(field);
  });
});

describe("GET /api/v1/products/{slug}", () => {
  it("returns 200 with the product", async () => {
    const res = await getProduct(request(`${PATH}/cappuccino`), params({ slug: "cappuccino" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: "cappuccino", name: "Cappuccino", priceMinor: 420000, currency: "NGN" });
  });

  it("returns 404 problem details for an unknown slug", async () => {
    const path = `${PATH}/does-not-exist`;
    await expectProblem(await getProduct(request(path), params({ slug: "does-not-exist" })), 404, path);
  });

  it("returns 404 for an inactive product", async () => {
    const path = `${PATH}/${inactive.slug}`;
    await expectProblem(await getProduct(request(path), params({ slug: inactive.slug })), 404, path);
  });

  it.each(["Bad_Slug", "UPPER", "trailing-", "a".repeat(121)])("returns 400 for malformed slug %s", async (slug) => {
    const path = `${PATH}/${slug}`;
    const body = await expectProblem(await getProduct(request(path), params({ slug })), 400, path);

    expect(body.errors?.[0]?.field).toBe("slug");
  });
});
