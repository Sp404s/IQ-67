import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/manrope/Manrope.ttf",
  variable: "--font-manrope",
  display: "swap",
});

const cormorant = localFont({
  src: [
    { path: "./fonts/cormorant/Cormorant-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/cormorant/Cormorant-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/cormorant/Cormorant-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/cormorant/Cormorant-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Арена переговоров",
  description: "Тренируйте переговоры, пробуйте разные подходы и анализируйте диалог.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru" className={`${manrope.variable} ${cormorant.variable}`}><body>{children}</body></html>;
}
