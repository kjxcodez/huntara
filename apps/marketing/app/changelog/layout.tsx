import { Metadata } from "next"

export const metadata: Metadata = {
  title: "System Changelog",
  description: "Chronological updates, feature additions, fixes, and release timeline for HUNTARA desktop.",
  openGraph: {
    title: "System Changelog | HUNTARA",
    description: "Chronological updates, feature additions, fixes, and release timeline for HUNTARA desktop.",
    url: "https://github.com/kjxcodez/huntara/changelog"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
