import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Blog & Logs",
  description: "Read technical engineering updates, database insights, and B2B sales thesis logs from the creators of HUNTARA.",
  openGraph: {
    title: "Blog & Logs | HUNTARA",
    description: "Read technical engineering updates, database insights, and B2B sales thesis logs from the creators of HUNTARA.",
    url: "https://github.com/kjxcodez/leadforge-os/blog"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
