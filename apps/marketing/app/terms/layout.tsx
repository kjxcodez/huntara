import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service & Licensing",
  description: "Terms of service, usage guidelines, and MIT license specifications for HUNTARA software.",
  openGraph: {
    title: "Terms of Service & Licensing | HUNTARA",
    description: "Terms of service, usage guidelines, and MIT license specifications for HUNTARA software.",
    url: "https://github.com/kjxcodez/leadforge-os/terms"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
