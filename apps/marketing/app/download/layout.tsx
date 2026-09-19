import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Download HUNTARA",
  description: "Get the latest production-ready desktop installer package for HUNTARA on Windows and other platforms.",
  openGraph: {
    title: "Download HUNTARA | HUNTARA",
    description: "Get the latest production-ready desktop installer package for HUNTARA on Windows and other platforms.",
    url: "https://github.com/kjxcodez/leadforge-os/download"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
