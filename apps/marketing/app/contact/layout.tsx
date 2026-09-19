import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Get in Touch",
  description: "Contact the HUNTARA team for queries, feedback, or custom integrations.",
  openGraph: {
    title: "Get in Touch | HUNTARA",
    description: "Contact the HUNTARA team for queries, feedback, or custom integrations.",
    url: "https://github.com/kjxcodez/huntara/contact"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
