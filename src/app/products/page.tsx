import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AddToCartButton } from "@/components/AddToCartButton";
import { formatMoney } from "@/lib/money";
import { MAX_LIMIT } from "@/lib/pagination";
import { listProducts, productCategory } from "@/lib/products";
import { createPublicClient } from "@/lib/supabase/clients";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const headings = { coffee: "Our Coffee", pastry: "Our Pastry" } as const;

// Design/Product Page.png
export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const category = productCategory.safeParse((await searchParams).category).data;
  const { data: products } = await listProducts(createPublicClient(), { limit: MAX_LIMIT, category });

  return (
    <section className="mx-auto max-w-[1184px] px-4 py-16 sm:px-8 md:py-44">
      <h1 className={category ? "mb-12 font-body text-4xl font-extrabold" : "sr-only"}>
        {category ? headings[category] : "Products"}
      </h1>

      {products.length === 0 ? (
        <p className="text-center text-xl">
          Nothing here yet.{" "}
          <Link href="/products" className="underline">
            See all products
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-24 md:gap-40">
          {products.map((p, i) => (
            <li key={p.id} className="grid items-center gap-8 md:grid-cols-[500px_1fr] md:gap-10">
              <Image
                src={p.imageUrl}
                alt={p.name}
                width={500}
                height={500}
                priority={i === 0}
                sizes="(min-width: 768px) 500px, 100vw"
                className="aspect-square w-full rounded-l-[3.4rem] object-cover"
              />
              <div className="md:px-2">
                <h2 className="font-body text-3xl font-extrabold md:text-[2.6rem]">{p.name}</h2>
                <p className="mt-8 text-lg leading-snug md:mt-14 md:text-justify md:text-[1.4rem]">{p.description}</p>
                <div className="mt-8 flex items-center justify-between gap-4 md:mt-10">
                  <p className="text-xl md:text-[1.4rem]">{formatMoney(p.priceMinor, p.currency)}</p>
                  <AddToCartButton
                    product={{
                      productId: p.id,
                      slug: p.slug,
                      name: p.name,
                      imageUrl: p.imageUrl,
                      unitPriceMinor: p.priceMinor,
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
