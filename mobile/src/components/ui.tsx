import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from "react-native";
import type { CartSyncStatus } from "@/lib/cart-sync";
import { colors, radius } from "@/theme";

type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  label: string;
  variant?: "outline" | "solid" | "light";
  busy?: boolean;
  style?: ViewStyle;
};

/** The site's pill buttons (Design/button_*.svg): outline = white with a thick espresso border. */
export function PillButton({ label, variant = "outline", busy, disabled, style, ...rest }: ButtonProps) {
  const solid = variant === "solid";
  const light = variant === "light";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.pill,
        solid && styles.pillSolid,
        light && styles.pillLight,
        (pressed || disabled) && { opacity: 0.7 },
        style,
      ]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={solid ? colors.paper : colors.espresso} />
      ) : (
        <Text style={[styles.pillText, solid && { color: colors.paper }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const SYNC_LABEL: Record<CartSyncStatus | "signed-out", string> = {
  live: "Live: synced with the website",
  connecting: "Connecting…",
  offline: "Offline: will sync when reconnected",
  "signed-out": "",
};

/** Shows whether cart changes from the website arrive instantly. */
export function SyncBadge({ status }: { status: CartSyncStatus | "signed-out" }) {
  if (status === "signed-out") return null;
  const color = status === "live" ? colors.live : status === "offline" ? colors.danger : colors.muted;
  return (
    <View style={styles.sync} accessibilityLabel={SYNC_LABEL[status]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.syncText, { color }]}>{SYNC_LABEL[status]}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.espresso,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  pillSolid: { backgroundColor: colors.espresso },
  pillLight: { borderWidth: 0, backgroundColor: colors.paper },
  pillText: { color: colors.espresso, fontSize: 17, fontWeight: "600" },
  sync: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  syncText: { fontSize: 13, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 15, marginTop: 8 },
});
