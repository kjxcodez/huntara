import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy & Data Guidelines",
  description: "Review our local data security, zero tracker telemetry, and SQLite database storage encryption policies.",
  openGraph: {
    title: "Privacy Policy & Data Guidelines | HUNTARA",
    description: "Review our local data security, zero tracker telemetry, and SQLite database storage encryption policies.",
    url: "https://github.com/kjxcodez/huntara/privacy"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
