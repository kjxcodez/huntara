import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Local-First Architecture",
  description: "Technical outline of HUNTARA multithreaded Chromium scrapers, Ollama LLM integration, and SQLite WAL database architecture.",
  openGraph: {
    title: "Local-First Architecture | HUNTARA",
    description: "Technical outline of HUNTARA multithreaded Chromium scrapers, Ollama LLM integration, and SQLite WAL database architecture.",
    url: "https://github.com/kjxcodez/huntara/architecture"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
