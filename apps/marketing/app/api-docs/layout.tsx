import { Metadata } from "next"

export const metadata: Metadata = {
  title: "API & Integrations Reference",
  description: "Direct SQLite query schemas and Node.js code snippets to query HUNTARA local database structures.",
  openGraph: {
    title: "API & Integrations Reference | HUNTARA",
    description: "Direct SQLite query schemas and Node.js code snippets to query HUNTARA local database structures.",
    url: "https://github.com/kjxcodez/huntara/api-docs"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
