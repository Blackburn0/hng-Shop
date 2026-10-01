import Image from "next/image";
import Link from "next/link";
import { pillOutline } from "@/components/ui";

// Design/Home Page.png
export default function HomePage() {
  return (
    <section className="py-8 md:py-12">
      <div className="relative isolate min-h-[560px] overflow-hidden md:min-h-[880px]">
        {/* Photo: Jonathan Borba via Pexels (Design/pexels-jonathan-borba-2878713 1.png) */}
        <Image
          src="/hero.jpg"
          alt="Pour-over coffee, a cup of black coffee and fresh cherries on a stone table"
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
        />

        <div className="absolute inset-x-0 top-16 max-w-[800px] rounded-r-[2.5rem] bg-espresso/60 px-6 py-10 text-paper sm:pl-16 md:top-36 md:py-14 md:pl-32 md:pr-12">
          <h1 className="font-display text-5xl font-bold uppercase leading-[1.05] sm:text-6xl md:text-[5.5rem]">
            Discover
            <br />
            New
            <br />
            Flavours
          </h1>
          <p className="mt-4 max-w-md font-display text-2xl leading-tight md:text-[1.9rem]">
            Coffee always sounds like a brilliant idea.
          </p>
        </div>

        <Link
          href="/products"
          className={`${pillOutline} absolute bottom-10 right-4 h-14 text-xl sm:right-16 md:bottom-36 md:right-32 md:text-2xl`}
        >
          Shop All Products <span aria-hidden="true">&gt;</span>
        </Link>
      </div>
    </section>
  );
}
