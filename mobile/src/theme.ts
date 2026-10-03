// Design tokens from the website (src/app/globals.css / Design/*.png).
export const colors = {
  espresso: "#351C0F",
  pill: "#E8E8E8",
  paper: "#FFFFFF",
  ink: "#000000",
  muted: "#6B5B53",
  line: "#E4DCD7",
  danger: "#B42318",
  live: "#2E7D32",
};

export const radius = { card: 24, image: 28, pill: 999 };

// No custom fonts in Expo Go without extra packages; a serif italic stands in
// for the script "Coffee Shop" logo.
export const fonts = {
  logo: { fontFamily: "serif", fontStyle: "italic" as const, fontWeight: "600" as const },
};
