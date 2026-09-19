import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Help & Operator Support",
  description: "Submit support tickets, review troubleshooting guidelines, and debug SQLite database lock exceptions.",
  openGraph: {
    title: "Help & Operator Support | HUNTARA",
    description: "Submit support tickets, review troubleshooting guidelines, and debug SQLite database lock exceptions.",
    url: "https://github.com/kjxcodez/leadforge-os/support"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
