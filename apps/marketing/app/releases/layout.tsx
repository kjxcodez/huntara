import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Software Releases",
  description: "Review release history, check SHA-256 binary validation, and download older software builds.",
  openGraph: {
    title: "Software Releases | HUNTARA",
    description: "Review release history, check SHA-256 binary validation, and download older software builds.",
    url: "https://github.com/kjxcodez/huntara/releases"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
