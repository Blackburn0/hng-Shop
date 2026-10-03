import { Redirect } from "expo-router";

// Target of the Google sign-in redirect. AuthProvider reads the ?code= from the
// in-app browser's result (and on web, WebBrowser.maybeCompleteAuthSession()
// closes the popup), so if the app is ever opened on this route directly, just
// go to the Account tab.
export default function AuthCallback() {
  return <Redirect href="/account" />;
}
