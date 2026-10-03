import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { ErrorText, PillButton } from "@/components/ui";
import { formatDate, orderNumber, STATUS } from "@/components/status";
import { ApiError, type Order } from "@/lib/api";
import { formatNaira } from "@/lib/money";
import { api } from "@/lib/shop-api";
import { colors } from "@/theme";

export default function OrdersScreen() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const page = await api.orders();
      setOrders(page.data);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your orders.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  // Reload whenever the tab is opened (e.g. right after checking out).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api.orders(cursor);
      setOrders((o) => [...o, ...page.data]);
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Your orders</Text>
        <Text style={styles.muted}>Sign in to see orders from the app and the website.</Text>
        <PillButton label="Sign in" onPress={() => router.push("/account")} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.espresso} />}
      onEndReached={() => void more()}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Your orders</Text>
          {error && <ErrorText>{error}</ErrorText>}
        </>
      }
      ListEmptyComponent={loading ? null : <Text style={styles.muted}>No orders yet.</Text>}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Order ${orderNumber(item.id)}, ${STATUS[item.status].badge}`}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.number}>#{orderNumber(item.id)}</Text>
            <Text style={styles.muted}>
              {formatDate(item.createdAt)} · {item.items.reduce((n, i) => n + i.quantity, 0)} item(s)
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Text style={styles.total}>{formatNaira(item.totalMinor)}</Text>
            <Text style={styles.badge}>{STATUS[item.status].badge}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 32, fontWeight: "800", marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 15, marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 12,
  },
  number: { fontSize: 18, fontWeight: "800" },
  total: { fontSize: 17 },
  badge: {
    backgroundColor: colors.espresso,
    color: colors.paper,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
});
