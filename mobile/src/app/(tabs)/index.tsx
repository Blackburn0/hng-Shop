import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, ImageBackground, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useCart } from "@/cart/CartProvider";
import { ErrorText, PillButton } from "@/components/ui";
import { ApiError, type Product } from "@/lib/api";
import { absoluteUrl } from "@/lib/config";
import { formatNaira } from "@/lib/money";
import { api } from "@/lib/shop-api";
import { colors, radius } from "@/theme";

// Design/Home Page.png + Design/Product Page.png, stacked for a phone.
export default function ShopScreen() {
  const { session } = useAuth();
  const cart = useCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts((await api.products()).data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(product: Product) {
    if (!session) {
      router.push("/account");
      return;
    }
    setAdding(product.id);
    await cart.add(product);
    setAdding(null);
  }

  return (
    <FlatList
      data={products}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.espresso} />}
      contentContainerStyle={{ paddingBottom: 32 }}
      ListHeaderComponent={
        <>
          <ImageBackground source={{ uri: absoluteUrl("/hero.jpg") }} style={styles.hero} resizeMode="cover">
            <View style={styles.heroPanel}>
              <Text style={styles.heroTitle}>DISCOVER{"\n"}NEW{"\n"}FLAVOURS</Text>
              <Text style={styles.heroSub}>Coffee always sounds like a brilliant idea.</Text>
            </View>
          </ImageBackground>
          {!session && (
            <Text style={styles.hint}>Sign in on the Account tab to add to your cart. It's the same cart as the website.</Text>
          )}
          {error && (
            <View style={{ paddingHorizontal: 16 }}>
              <ErrorText>{error}</ErrorText>
            </View>
          )}
        </>
      }
      renderItem={({ item }) => {
        const inCart = cart.cart.items.find((i) => i.productId === item.id)?.quantity ?? 0;
        return (
          <View style={styles.card}>
            <Image source={{ uri: absoluteUrl(item.imageUrl) }} style={styles.image} accessibilityIgnoresInvertColors />
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.description}>{item.description}</Text>
            <View style={styles.row}>
              <Text style={styles.price}>{formatNaira(item.priceMinor)}</Text>
              <PillButton
                label={inCart > 0 ? `Add to Cart (${inCart})` : "Add to Cart"}
                onPress={() => void add(item)}
                busy={adding === item.id}
                accessibilityLabel={`Add ${item.name} to cart`}
              />
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  hero: { height: 340, justifyContent: "center", marginBottom: 8 },
  heroPanel: {
    backgroundColor: "rgba(53, 28, 15, 0.6)",
    paddingVertical: 28,
    paddingHorizontal: 24,
    marginRight: 32,
    borderTopRightRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroTitle: { color: colors.paper, fontSize: 40, lineHeight: 44, fontWeight: "800" },
  heroSub: { color: colors.paper, fontSize: 18, marginTop: 10 },
  hint: { marginHorizontal: 16, marginTop: 8, color: colors.muted, fontSize: 15 },
  card: { marginHorizontal: 16, marginTop: 28 },
  image: {
    width: "100%",
    aspectRatio: 1,
    borderTopLeftRadius: radius.image,
    borderBottomLeftRadius: radius.image,
    backgroundColor: colors.pill,
  },
  name: { fontSize: 26, fontWeight: "800", marginTop: 16 },
  description: { fontSize: 16, lineHeight: 22, marginTop: 8, color: "#222" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, gap: 12 },
  price: { fontSize: 19 },
});
