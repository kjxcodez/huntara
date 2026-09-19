import { Geist, Geist_Mono, Inter } from "next/font/google"
import { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "HUNTARA — Find the companies worth selling to.",
    template: "%s | HUNTARA"
  },
  description: "HUNTARA helps businesses find and understand their next customers. Local-first outbound intelligence, lead qualification, and sequences.",
  keywords: [
    "HUNTARA",
    "find the companies worth selling to",
    "b2b lead discovery",
    "local-first lead generation",
    "open source outbound engine",
    "sales intelligence",
    "private lead enrichment",
    "self-hosted B2B outreach",
    "zero telemetry lead generation"
  ],
  authors: [{ name: "kjxcodez", url: "https://github.com/kjxcodez" }],
  creator: "kjxcodez",
  metadataBase: new URL("https://github.com/kjxcodez/huntara"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://github.com/kjxcodez/huntara",
    title: "HUNTARA — Find the companies worth selling to.",
    description: "HUNTARA helps businesses find and understand their next customers.",
    siteName: "HUNTARA"
  },
  twitter: {
    card: "summary_large_image",
    title: "HUNTARA — Find the companies worth selling to.",
    description: "HUNTARA helps businesses find and understand their next customers."
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1
    }
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Structured JSON-LD Data for SEO, AEO, and GEO crawling engines
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "HUNTARA",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Windows 10, Windows 11, macOS, Linux",
    "license": "https://opensource.org/licenses/MIT",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "creator": {
      "@type": "Person",
      "name": "kjxcodez",
      "url": "https://github.com/kjxcodez"
    },
    "description": "HUNTARA helps businesses find and understand their next customers."
  }

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased dark", fontMono.variable, "font-sans", inter.variable)}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] selection:bg-[rgba(250,113,37,0.15)] selection:text-[var(--foreground)]">
        <ThemeProvider>
          <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-grow">{children}</main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
