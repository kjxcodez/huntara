import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Security & Data Ownership",
  description: "How HUNTARA ensures 100% data ownership with localized SMTP keys, sandboxed tasks, and zero telemetry logs.",
  openGraph: {
    title: "Security & Data Ownership | HUNTARA",
    description: "How HUNTARA ensures 100% data ownership with localized SMTP keys, sandboxed tasks, and zero telemetry logs.",
    url: "https://github.com/kjxcodez/huntara/security"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
