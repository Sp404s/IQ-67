import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Арена переговоров",
  description: "Тренируйте переговоры, пробуйте разные подходы и анализируйте диалог.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
