import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tabkur Scanner",
  description:
    "Upload foto tabel, otomatis kelompokkan per nm_sentra dan tandai (tabkur) dari sel merah.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <header className="border-b bg-white/70 backdrop-blur">
          <div className="container-page flex h-14 items-center justify-between">
            <div className="text-base font-semibold">Tabkur Scanner</div>
          </div>
        </header>
        <main className="container-page py-8">{children}</main>
        <footer className="container-page py-8 text-xs text-gray-500">
          © {new Date().getFullYear()} Tabkur Scanner
        </footer>
      </body>
    </html>
  );
}
