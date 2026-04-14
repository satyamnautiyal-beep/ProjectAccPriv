import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import QueryProvider from "../components/QueryProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata = {
  title: "HealthEnroll - Enterprise Healthcare Enrollment Platform",
  description: "High-fidelity enterprise SaaS frontend for healthcare enrollment",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div style={{ display: 'flex', minHeight: '100vh', width: '100vw' }}>
          <Sidebar />
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <Topbar />
            <main style={{ flex: 1, backgroundColor: 'var(--bg-root)', overflow: 'auto', padding: 'var(--space-6)' }}>
              <QueryProvider>
                {children}
              </QueryProvider>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
