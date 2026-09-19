import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Press Kit & Assets",
  description: "Press assets, product description copies, and graphics packages for journalists covering HUNTARA.",
  openGraph: {
    title: "Press Kit & Assets | HUNTARA",
    description: "Press assets, product description copies, and graphics packages for journalists covering HUNTARA.",
    url: "https://github.com/kjxcodez/huntara/press"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
