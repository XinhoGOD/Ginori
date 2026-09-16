import "./globals.css";
import { AppShell } from "../components/AppShell";

export const metadata = {
  title: "Fantasy Market Tracker",
  description:
    "Análisis determinístico de movimientos del mercado Fantasy NFL.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
