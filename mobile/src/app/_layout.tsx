import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/auth/AuthProvider";
import { CartProvider } from "@/cart/CartProvider";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <AuthProvider>
      <CartProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.espresso },
            headerTintColor: colors.paper,
            contentStyle: { backgroundColor: colors.paper },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="order/[id]" options={{ title: "Your order" }} />
          <Stack.Screen name="payment/[reference]" options={{ title: "Confirming payment", headerBackVisible: false }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        </Stack>
      </CartProvider>
    </AuthProvider>
  );
}
