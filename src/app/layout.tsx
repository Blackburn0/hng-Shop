import type { Metadata } from "next";
import { Jost, Nothing_You_Could_Do, Nunito_Sans } from "next/font/google";
import "./globals.css";

const jost = Jost({ subsets: ["latin"], variable: "--font-jost" });
const nunitoSans = Nunito_Sans({ subsets: ["latin"], variable: "--font-nunito-sans" });
const scriptLogo = Nothing_You_Could_Do({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-script-logo",
});

export const metadata: Metadata = {
  title: "Coffee Shop",
  description: "One stop | one heart | one cup",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jost.variable} ${nunitoSans.variable} ${scriptLogo.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
