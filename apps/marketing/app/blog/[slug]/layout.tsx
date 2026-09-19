import { Metadata } from "next"

const articlesMetadata = {
  "local-first-data-outreach": {
    title: "Why Local-First Outreach is the Future of B2B Sales",
    description: "Learn why shifting from cloud CRM and outreach engines to local-first outbound architectures keeps your B2B prospects database private and runs outbound tasks at sub-millisecond speeds."
  },
  "sqlite-wal-mode-electron": {
    title: "SQLite WAL Mode inside Electron Subprocesses",
    description: "An in-depth technical look at enabling SQLite Write-Ahead Logging (WAL) and synchronous pragma modes within Electron subprocesses to handle high-concurrency lead scraping."
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const resolvedParams = await params
  const slug = resolvedParams.slug
  const article = articlesMetadata[slug as keyof typeof articlesMetadata]
  
  if (!article) {
    return {
      title: "Post Not Found"
    }
  }

  return {
    title: article.title,
    description: article.description,
    openGraph: {
      title: `${article.title} | HUNTARA Blog`,
      description: article.description
    }
  }
}

export default function BlogPostLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
