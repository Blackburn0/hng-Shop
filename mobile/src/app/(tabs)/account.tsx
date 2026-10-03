import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { redirectUri, useAuth } from "@/auth/AuthProvider";
import { useCart } from "@/cart/CartProvider";
import { ErrorText, PillButton, SyncBadge } from "@/components/ui";
import { API_URL } from "@/lib/config";
import { colors, fonts } from "@/theme";

export default function AccountScreen() {
  const { session, ready, signIn, signOut } = useAuth();
  const { sync } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn() {
    setBusy(true);
    setError(await signIn());
    setBusy(false);
  }

  if (!ready) return <View style={styles.page} />;

  if (!session) {
    return (
      <View style={styles.page}>
        <View style={styles.card}>
          <Text style={[fonts.logo, styles.logo]}>Coffee Shop</Text>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardBody}>Use the same Google account as on the website. Your cart and orders are shared.</Text>
          <PillButton label="Continue with Google" variant="light" busy={busy} onPress={() => void onSignIn()} style={{ marginTop: 24 }} />
          {error && <Text style={styles.cardError}>{error}</Text>}
        </View>
        {__DEV__ && <Text style={styles.dev}>Sign-in redirect: {redirectUri}</Text>}
      </View>
    );
  }

  const meta = session.user.user_metadata as { full_name?: string; name?: string; avatar_url?: string };
  return (
    <View style={styles.page}>
      <View style={styles.profile}>
        {meta.avatar_url ? (
          <Image source={{ uri: meta.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.initial]}>
            <Text style={{ color: colors.paper, fontSize: 28, fontWeight: "800" }}>
              {(meta.full_name ?? session.user.email ?? "?").charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={styles.name}>{meta.full_name ?? meta.name ?? "Signed in"}</Text>
        <Text style={styles.email}>{session.user.email}</Text>
        <View style={{ marginTop: 12 }}>
          <SyncBadge status={sync} />
        </View>
      </View>
      <PillButton label="Sign out" onPress={() => void signOut()} style={{ marginTop: 32 }} />
      {error && <ErrorText>{error}</ErrorText>}
      <Text style={styles.dev}>Shop server: {API_URL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 20, justifyContent: "center" },
  card: { backgroundColor: colors.espresso, borderRadius: 32, padding: 28 },
  logo: { color: colors.paper, fontSize: 30, textAlign: "center" },
  cardTitle: { color: colors.paper, fontSize: 32, fontWeight: "800", textAlign: "center", marginTop: 12 },
  cardBody: { color: colors.paper, fontSize: 16, textAlign: "center", marginTop: 10 },
  cardError: { color: colors.paper, backgroundColor: "rgba(255,255,255,0.15)", padding: 12, borderRadius: 14, marginTop: 16 },
  profile: { alignItems: "center" },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: colors.espresso },
  initial: { backgroundColor: colors.espresso, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 24, fontWeight: "800", marginTop: 14 },
  email: { fontSize: 15, color: colors.muted, marginTop: 4 },
  dev: { marginTop: 24, fontSize: 12, color: colors.muted, textAlign: "center" },
});
