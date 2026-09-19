import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Open Source Outreach Engine",
  description: "Review our codebase license, local telemetry philosophy, and help build a faster private cold outbound engine.",
  openGraph: {
    title: "Open Source Outreach Engine | HUNTARA",
    description: "Review our codebase license, local telemetry philosophy, and help build a faster private cold outbound engine.",
    url: "https://github.com/kjxcodez/huntara/open-source"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
