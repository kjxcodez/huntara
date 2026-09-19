import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Brand Guidelines & Logo Marks",
  description: "Official HUNTARA brand assets, logo marks, app icons, and color palettes.",
  openGraph: {
    title: "Brand Guidelines & Logo Marks | HUNTARA",
    description: "Official HUNTARA brand assets, logo marks, app icons, and color palettes.",
    url: "https://github.com/kjxcodez/leadforge-os/brand"
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
