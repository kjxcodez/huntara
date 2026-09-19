import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description: "Answers to questions on local scrapers, proxy configurations, local AI models, and email security standards.",
  openGraph: {
    title: "Frequently Asked Questions | HUNTARA",
    description: "Answers to questions on local scrapers, proxy configurations, local AI models, and email security standards.",
    url: "https://github.com/kjxcodez/leadforge-os/faq"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
