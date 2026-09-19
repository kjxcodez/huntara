import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Service Status Cockpit",
  description: "Review operational uptime for download repositories, update checkers, and documentation mirrors.",
  openGraph: {
    title: "Service Status Cockpit | HUNTARA",
    description: "Review operational uptime for download repositories, update checkers, and documentation mirrors.",
    url: "https://github.com/kjxcodez/leadforge-os/status"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
