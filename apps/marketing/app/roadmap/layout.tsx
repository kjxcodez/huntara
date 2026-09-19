import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Development Roadmap",
  description: "Follow our product progress, upcoming features, macOS and Linux releases, and API integrations.",
  openGraph: {
    title: "Development Roadmap | HUNTARA",
    description: "Follow our product progress, upcoming features, macOS and Linux releases, and API integrations.",
    url: "https://github.com/kjxcodez/huntara/roadmap"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
