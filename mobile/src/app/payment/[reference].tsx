import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ImageBackground, StyleSheet, Text, View } from "react-native";
import { useCart } from "@/cart/CartProvider";
import { PillButton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { absoluteUrl } from "@/lib/config";
import { api } from "@/lib/shop-api";
import { colors } from "@/theme";

const POLL_MS = 2500;
const MAX_ATTEMPTS = 72; // ~3 minutes: typing a card number on a phone takes longer than on the web

type Phase = "checking" | "failed" | "slow" | "error";

// Design/Loading Page.png. Opened when Paystack's checkout opens; asks the API
// (which asks Paystack) until the payment settles.
export default function PaymentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const { refresh } = useCart();
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("Complete the payment in the Paystack window, then come back here.");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check(attempt: number) {
      try {
        const result = await api.verifyPayment(reference);
        if (cancelled) return;
        if (result.status === "paid") {
          await refresh();
          router.replace({ pathname: "/order/[id]", params: { id: result.order.id } });
          return;
        }
        if (result.status === "failed") {
          setPhase("failed");
          setMessage("Your payment didn't go through, so you haven't been charged. Your cart is still saved.");
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 409 || err.status === 401)) {
          setPhase("error");
          setMessage(err.message);
          return;
        }
        // 502 or a network blip: keep trying
      }
      if (attempt + 1 >= MAX_ATTEMPTS) {
        setPhase("slow");
        setMessage("We're still waiting for Paystack. Your order will update in the Orders tab once it's through.");
        return;
      }
      timer = setTimeout(() => void check(attempt + 1), POLL_MS);
    }

    void check(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reference, refresh]);

  return (
    <ImageBackground source={{ uri: absoluteUrl("/hero.jpg") }} style={styles.bg} resizeMode="cover">
      <View style={styles.band}>
        {phase === "checking" && <ActivityIndicator size="large" color={colors.paper} style={{ transform: [{ scale: 1.6 }] }} />}
        <Text style={styles.title}>{phase === "failed" ? "Payment not completed" : "One Step\nCloser to\nYour Doorstep"}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
        {phase !== "checking" && (
          <View style={{ gap: 12, marginTop: 20, alignSelf: "stretch" }}>
            {phase === "failed" && <PillButton label="Try again" onPress={() => router.navigate("/cart")} />}
            <PillButton label="View orders" onPress={() => router.navigate("/orders")} />
          </View>
        )}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, justifyContent: "center" },
  band: { backgroundColor: "rgba(53, 28, 15, 0.6)", paddingVertical: 40, paddingHorizontal: 24, alignItems: "center", gap: 18 },
  title: { color: colors.paper, fontSize: 36, lineHeight: 44, fontWeight: "800", textAlign: "center" },
  message: { color: colors.paper, fontSize: 17, textAlign: "center" },
});
