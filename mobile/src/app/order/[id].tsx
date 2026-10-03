import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ErrorText, PillButton } from "@/components/ui";
import { formatDate, orderNumber, STATUS } from "@/components/status";
import { ApiError, type Order } from "@/lib/api";
import { formatNaira } from "@/lib/money";
import { api } from "@/lib/shop-api";
import { colors } from "@/theme";

// The website's order confirmation page (src/app/orders/[id]/page.tsx) for a phone.
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .order(id)
      .then((o) => !cancelled && setOrder(o))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load this order."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <View style={styles.page}>
        <ErrorText>{error}</ErrorText>
      </View>
    );
  }
  if (!order) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.espresso} />;

  const copy = STATUS[order.status];
  const firstName = order.delivery.name.trim().split(/\s+/)[0];
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={[styles.check, !copy.good && styles.checkOutline]}>
        <Text style={{ color: copy.good ? colors.paper : colors.espresso, fontSize: 34, fontWeight: "800" }}>
          {copy.good ? "✓" : "!"}
        </Text>
      </View>
      <Text style={styles.heading}>
        {copy.heading}
        {copy.good ? `, ${firstName}!` : ""}
      </Text>
      <Text style={styles.body}>{copy.body}</Text>
      <Text style={styles.meta}>
        Order #{orderNumber(order.id)} · {formatDate(order.createdAt)}
      </Text>
      <Text style={styles.badge}>{copy.badge}</Text>

      <Text style={styles.section}>Order summary</Text>
      {order.items.map((item, i) => (
        <View key={`${item.productName}-${i}`} style={styles.row}>
          <Text style={{ flex: 1, fontSize: 16 }}>
            <Text style={{ fontWeight: "800" }}>{item.productName}</Text>
            {`  ${item.quantity} × ${formatNaira(item.unitPriceMinor)}`}
          </Text>
          <Text style={{ fontSize: 16 }}>{formatNaira(item.lineTotalMinor)}</Text>
        </View>
      ))}
      <View style={[styles.row, { borderBottomWidth: 0 }]}>
        <Text style={styles.totalLabel}>Total:</Text>
        <Text style={styles.total}>{formatNaira(order.totalMinor)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Delivery</Text>
        <Text style={styles.cardText}>{order.delivery.name}</Text>
        <Text style={styles.cardText}>{order.delivery.phone}</Text>
        <Text style={styles.cardText}>{order.delivery.address}</Text>
        <Text style={[styles.cardTitle, { marginTop: 18 }]}>Payment</Text>
        <Text style={styles.cardText}>{order.paymentMethod === "card" ? "Card via Paystack" : "Cash on delivery"}</Text>
      </View>

      <PillButton label="< Continue shopping" onPress={() => router.navigate("/")} style={{ marginTop: 28 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, alignItems: "stretch" },
  check: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOutline: { backgroundColor: colors.paper, borderWidth: 4, borderColor: colors.espresso },
  heading: { fontSize: 32, fontWeight: "800", textAlign: "center", marginTop: 16 },
  body: { fontSize: 16, textAlign: "center", marginTop: 8 },
  meta: { fontSize: 14, textAlign: "center", marginTop: 12, color: colors.muted },
  badge: {
    alignSelf: "center",
    marginTop: 8,
    backgroundColor: colors.espresso,
    color: colors.paper,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  section: { fontSize: 24, fontWeight: "800", marginTop: 28, borderBottomWidth: 1.5, paddingBottom: 6 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 12,
  },
  totalLabel: { fontSize: 22, fontWeight: "800" },
  total: { fontSize: 22 },
  card: { marginTop: 24, backgroundColor: colors.espresso, borderRadius: 32, padding: 24 },
  cardTitle: { color: colors.paper, fontSize: 22, fontWeight: "800", marginBottom: 6 },
  cardText: { color: colors.paper, fontSize: 16, lineHeight: 24 },
});
