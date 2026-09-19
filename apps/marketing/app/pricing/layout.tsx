import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Beta Pricing Plans",
  description: "HUNTARA is currently free during public beta. View licensing plans and local hardware requirements.",
  openGraph: {
    title: "Beta Pricing Plans | HUNTARA",
    description: "HUNTARA is currently free during public beta. View licensing plans and local hardware requirements.",
    url: "https://github.com/kjxcodez/huntara/pricing"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
