import { Tabs } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Text, type ColorValue } from "react-native";
import { useCart } from "@/cart/CartProvider";
import { colors, fonts } from "@/theme";

// SF Symbols on iOS, Material Symbols on Android and web.
const icon = (name: SymbolViewProps["name"]) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={color} size={size} />;
  };

export default function TabsLayout() {
  const { cart } = useCart();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.espresso },
        headerTintColor: colors.paper,
        headerTitle: () => <Text style={{ ...fonts.logo, color: colors.paper, fontSize: 26 }}>Coffee Shop</Text>,
        headerTitleAlign: "left",
        tabBarActiveTintColor: colors.espresso,
        tabBarInactiveTintColor: "#8C7B72",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Shop", tabBarIcon: icon({ ios: "cup.and.saucer", android: "local_cafe", web: "local_cafe" }) }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: icon({ ios: "cart", android: "shopping_cart", web: "shopping_cart" }),
          tabBarBadge: cart.itemCount > 0 ? cart.itemCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.espresso, color: colors.paper },
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: "Orders", tabBarIcon: icon({ ios: "list.bullet.rectangle", android: "receipt_long", web: "receipt_long" }) }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: "Account", tabBarIcon: icon({ ios: "person.crop.circle", android: "account_circle", web: "account_circle" }) }}
      />
    </Tabs>
  );
}
