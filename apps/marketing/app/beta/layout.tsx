import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Join the Beta Program",
  description: "Apply for early beta program to crawl and qualify outbound prospects locally on Windows systems.",
  openGraph: {
    title: "Join the Beta Program | HUNTARA",
    description: "Apply for early beta program to crawl and qualify outbound prospects locally on Windows systems.",
    url: "https://github.com/kjxcodez/leadforge-os/beta"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
