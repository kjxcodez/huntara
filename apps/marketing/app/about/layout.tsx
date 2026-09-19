import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Manifesto & About",
  description: "Learn about the local-first B2B outbound manifesto and data compliance philosophy behind HUNTARA.",
  openGraph: {
    title: "Manifesto & About | HUNTARA",
    description: "Learn about the local-first B2B outbound manifesto and data compliance philosophy behind HUNTARA.",
    url: "https://github.com/kjxcodez/huntara/about"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
