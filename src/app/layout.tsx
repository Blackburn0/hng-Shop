import type { Metadata } from "next";
import { Jost, Nothing_You_Could_Do, Nunito_Sans } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const jost = Jost({ subsets: ["latin"], variable: "--font-jost" });
const nunitoSans = Nunito_Sans({ subsets: ["latin"], variable: "--font-nunito-sans" });
const scriptLogo = Nothing_You_Could_Do({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-script-logo",
});

export const metadata: Metadata = {
  title: { default: "Coffee Shop", template: "%s · Coffee Shop" },
  description: "one Stop | one Heart | one Cup",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jost.variable} ${nunitoSans.variable} ${scriptLogo.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
