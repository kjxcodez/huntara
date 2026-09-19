import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Platform Features",
  description: "Explore Google Maps scrapers, local Ollama contact enrichment, sandboxed Chromium workers, and SMTP mail relay tools.",
  openGraph: {
    title: "Platform Features | HUNTARA",
    description: "Explore Google Maps scrapers, local Ollama contact enrichment, sandboxed Chromium workers, and SMTP mail relay tools.",
    url: "https://github.com/kjxcodez/huntara/features"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
