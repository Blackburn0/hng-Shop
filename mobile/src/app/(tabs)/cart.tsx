import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useCart } from "@/cart/CartProvider";
import { ErrorText, PillButton, SyncBadge } from "@/components/ui";
import { ApiError, type Delivery } from "@/lib/api";
import { absoluteUrl } from "@/lib/config";
import { formatNaira } from "@/lib/money";
import { api } from "@/lib/shop-api";
import { colors, radius } from "@/theme";

type Field = keyof Delivery;

// Design/Confirmation Page.png (the cart + "Pay By" card), for a phone.
export default function CartScreen() {
  const { session } = useAuth();
  const { cart, ready, sync, error, setQuantity, remove, refresh } = useCart();
  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const profileName = meta.full_name ?? meta.name ?? "";
  const [delivery, setDelivery] = useState<Delivery>({ name: profileName, phone: "", address: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [paying, setPaying] = useState<"card" | "cash" | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // On launch the screen can render before the saved session is restored; fill
  // in the Google name once it arrives (without overwriting anything typed).
  useEffect(() => {
    if (profileName) setDelivery((d) => (d.name ? d : { ...d, name: profileName }));
  }, [profileName]);

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Your cart</Text>
        <Text style={styles.body}>Sign in to see your cart. It's the same cart you use on the website.</Text>
        <PillButton label="Sign in" onPress={() => router.push("/account")} style={{ marginTop: 20 }} />
      </View>
    );
  }

  async function pay(method: "card" | "cash") {
    setPaying(method);
    setPayError(null);
    setFieldErrors({});
    try {
      const created = await api.createOrder(method, delivery);
      if (method === "card" && created.payment) {
        // Show the Loading screen first: on Android the browser opens on top and
        // this call returns straight away, while the screen polls the payment.
        router.push({ pathname: "/payment/[reference]", params: { reference: created.payment.reference } });
        await WebBrowser.openBrowserAsync(created.payment.authorizationUrl);
      } else {
        await refresh();
        router.push({ pathname: "/order/[id]", params: { id: created.order.id } });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fieldErrors.length) {
        const next: Partial<Record<Field, string>> = {};
        for (const e of err.fieldErrors) {
          const key = e.field.replace(/^delivery\./, "") as Field;
          if (key === "name" || key === "phone" || key === "address") next[key] ??= e.message;
        }
        setFieldErrors(next);
      } else {
        setPayError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        if (err instanceof ApiError && err.status === 409) await refresh();
      }
    } finally {
      setPaying(null);
    }
  }

  const input = (field: Field, label: string, extra: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={delivery[field]}
        onChangeText={(v) => setDelivery((d) => ({ ...d, [field]: v }))}
        style={[styles.input, fieldErrors[field] && { borderColor: colors.danger }]}
        editable={!paying}
        accessibilityLabel={label}
        {...extra}
      />
      {fieldErrors[field] && <ErrorText>{`${label} ${fieldErrors[field]}`}</ErrorText>}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Shopping Cart</Text>
          <SyncBadge status={sync} />
        </View>
        {error && <ErrorText>{error}</ErrorText>}

        {!ready ? (
          <Text style={styles.body}>Loading your cart…</Text>
        ) : cart.items.length === 0 ? (
          <>
            <Text style={styles.body}>Your cart is empty. Anything you add here or on the website shows up instantly.</Text>
            <PillButton label="< Back to Order" onPress={() => router.push("/")} style={{ marginTop: 20 }} />
          </>
        ) : (
          <>
            {cart.items.map((item) => (
              <View key={item.productId} style={styles.item}>
                <Image source={{ uri: absoluteUrl(item.imageUrl) }} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Pressable
                      onPress={() => void remove(item.productId)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name}`}
                      hitSlop={12}
                    >
                      <Text style={styles.remove}>✕</Text>
                    </Pressable>
                  </View>
                  <View style={[styles.rowBetween, { marginTop: 10 }]}>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => void setQuantity(item.productId, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        style={styles.stepBtn}
                        accessibilityLabel={`Decrease ${item.name} quantity`}
                      >
                        <Text style={[styles.stepText, item.quantity <= 1 && { opacity: 0.3 }]}>−</Text>
                      </Pressable>
                      <Text style={styles.qty}>{item.quantity}</Text>
                      <Pressable
                        onPress={() => void setQuantity(item.productId, item.quantity + 1)}
                        disabled={item.quantity >= 99}
                        style={styles.stepBtn}
                        accessibilityLabel={`Increase ${item.name} quantity`}
                      >
                        <Text style={styles.stepText}>+</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.line}>{formatNaira(item.lineTotalMinor)}</Text>
                  </View>
                </View>
              </View>
            ))}

            <View style={[styles.rowBetween, { marginTop: 18 }]}>
              <Text style={styles.totalLabel}>Total:</Text>
              <Text style={styles.total}>{formatNaira(cart.subtotalMinor)}</Text>
            </View>

            <Text style={[styles.title, { fontSize: 24, marginTop: 28 }]}>Delivery details</Text>
            {input("name", "Full name", { autoComplete: "name", textContentType: "name" })}
            {input("phone", "Phone", { keyboardType: "phone-pad", autoComplete: "tel", textContentType: "telephoneNumber" })}
            {input("address", "Delivery address", { multiline: true, autoComplete: "street-address" })}

            <View style={styles.payCard}>
              <Text style={styles.payTitle}>Pay By</Text>
              <Pressable
                onPress={() => void pay("card")}
                disabled={paying !== null}
                style={[styles.payButton, paying && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Pay by card with Paystack"
              >
                {paying === "card" ? (
                  <Text style={styles.payBusy}>Opening Paystack…</Text>
                ) : (
                  <Image source={{ uri: absoluteUrl("/pay-visa.png") }} style={{ width: 87, height: 55 }} resizeMode="contain" />
                )}
              </Pressable>
              <Pressable
                onPress={() => void pay("cash")}
                disabled={paying !== null}
                style={[styles.payButton, paying && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Pay cash on delivery"
              >
                {paying === "cash" ? (
                  <Text style={styles.payBusy}>Placing order…</Text>
                ) : (
                  <Image source={{ uri: absoluteUrl("/pay-cash.png") }} style={{ width: 127, height: 43 }} resizeMode="contain" />
                )}
              </Pressable>
              <Text style={styles.payNote}>Card payments are processed securely by Paystack (test mode).</Text>
              {payError && <Text style={styles.payError}>{payError}</Text>}
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: { gap: 6, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: "800" },
  body: { fontSize: 16, color: colors.muted, marginTop: 12, textAlign: "left" },
  item: { flexDirection: "row", gap: 14, paddingVertical: 16, borderBottomWidth: 1.5, borderBottomColor: colors.ink },
  thumb: { width: 76, height: 76, backgroundColor: colors.pill },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemName: { fontSize: 20, fontWeight: "800", flexShrink: 1 },
  remove: { fontSize: 20, color: "#777", paddingHorizontal: 6 },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: colors.ink, borderRadius: radius.pill },
  stepBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 24 },
  qty: { minWidth: 32, textAlign: "center", fontSize: 18 },
  line: { fontSize: 18 },
  totalLabel: { fontSize: 24, fontWeight: "800" },
  total: { fontSize: 24 },
  label: { fontSize: 15, marginBottom: 4 },
  input: {
    borderWidth: 2,
    borderColor: "rgba(53,28,15,0.4)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    backgroundColor: colors.paper,
  },
  payCard: { marginTop: 28, backgroundColor: colors.espresso, borderRadius: 36, padding: 24, gap: 16 },
  payTitle: { color: colors.paper, fontSize: 34, fontWeight: "800", textAlign: "center" },
  payButton: { height: 64, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  payBusy: { color: colors.espresso, fontSize: 17, fontWeight: "700" },
  payNote: { color: "rgba(255,255,255,0.8)", fontSize: 13, textAlign: "center" },
  payError: { color: colors.paper, backgroundColor: "rgba(255,255,255,0.15)", padding: 12, borderRadius: 14, textAlign: "center" },
});
