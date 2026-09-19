"use client"

import React, { use } from "react"
import { motion } from "motion/react"
import Link from "next/link"
import { ArrowLeft, Calendar, Clock, BookOpen } from "lucide-react"

interface PageProps {
  params: Promise<{ slug: string }>
}

export default function BlogPostPage({ params }: PageProps) {
  const resolvedParams = use(params)
  const slug = resolvedParams.slug

  const articles = {
    "local-first-data-outreach": {
      title: "Why Local-First Outreach is the Future of B2B Sales",
      date: "August 1, 2026",
      readTime: "6 min read",
      category: "Thesis",
      body: (
        <div className="space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed">
          <p>
            When we built HUNTARA, the primary challenge we wanted to tackle was not just speed or privacy, but 
            the fundamental ownership of sales records. In traditional cold email pipeline management, operators upload 
            hundreds of prospects, API credentials, and email drafts into multi-tenant SaaS dashboards.
          </p>
          <p>
            This design has three main weaknesses:
          </p>
          <ul className="list-disc list-inside space-y-2 pl-2">
            <li><strong>Vendor Locks:</strong> Exporting raw logs, WHOIS patterns, and metrics is made deliberately difficult to prevent churn.</li>
            <li><strong>Data Exposure:</strong> If the cloud dashboard has a security breach, all decrypted SMTP credential tokens are exposed.</li>
            <li><strong>Bloated Markups:</strong> You pay for cloud server hosting markups to run CPU-heavy scrapers, WHOIS handshakes, and crawlers.</li>
          </ul>
          <p>
            By shifting to a local-first system, HUNTARA resolves all three issues. All contacts sit safely on your disk inside 
            an SQLite database, and the CPU cores of your own machine handle the heavy parser loads, making the system fast, secure, 
            and free of cloud markup fees.
          </p>
        </div>
      )
    },
    "sqlite-wal-mode-electron": {
      title: "SQLite WAL Mode inside Electron Subprocesses",
      date: "July 18, 2026",
      readTime: "9 min read",
      category: "Engineering",
      body: (
        <div className="space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed">
          <p>
            SQLite databases are highly efficient for local-first desktop apps. However, because cold email enrichment involves 
            concurrently executing multiple scraper threads in the background, a standard SQLite file can hit database lock errors.
          </p>
          <p>
            To address this inside Electron, we enabled Write-Ahead Logging (WAL) mode:
          </p>
          <div className="bg-[var(--card)] border border-[var(--border)] p-4 rounded font-mono text-xs text-[var(--muted-foreground)] leading-relaxed">
            PRAGMA journal_mode = WAL;<br />
            PRAGMA synchronous = NORMAL;
          </div>
          <p>
            In WAL mode, instead of locking the database for every single scraped contact write, changes are written to a log file 
            separate from the database (`.wal`). Multiple reader threads can continue querying lists, contacts, and SMTP parameters 
            with zero lock delays, which are periodically checkpointed back to the primary `.db` file in idle states.
          </p>
        </div>
      )
    }
  }

  const article = articles[slug as keyof typeof articles]

  if (!article) {
    return (
      <div className="container mx-auto px-6 py-20 min-h-[80vh] flex flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Post Not Found</h1>
        <Link href="/blog" className="mt-4 text-xs text-[var(--primary)] hover:underline">
          Return to Blog
        </Link>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <div className="max-w-2xl mx-auto space-y-8">
        
        {/* Back Link */}
        <Link 
          href="/blog" 
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--foreground)] transition-colors duration-150"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Blog
        </Link>

        {/* Header Block */}
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {article.date}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {article.readTime}
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-[var(--foreground)] leading-tight">
            {article.title}
          </h1>
        </div>

        {/* Body Content */}
        <div className="border-t border-[var(--border-subtle)] pt-8">
          {article.body}
        </div>

      </div>
    </div>
  )
}
