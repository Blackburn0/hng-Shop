import type { Metadata } from "next";
import { CheckoutView } from "@/components/CheckoutView";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Checkout" };

// Design/Confirmation Page.png (the cart + "Pay By" panel)
export default async function CheckoutPage() {
  const user = await getCurrentUser();
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  return <CheckoutView signedIn={user !== null} defaultName={meta.full_name ?? meta.name ?? ""} />;
}
