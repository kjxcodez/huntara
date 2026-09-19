"use client"

import React from "react"
import { motion } from "motion/react"
import Link from "next/link"
import { Calendar, Clock, ArrowRight } from "lucide-react"

export default function BlogPage() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 }
    }
  }

  const childVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } }
  }

  const posts = [
    {
      slug: "local-first-data-outreach",
      title: "Why Local-First Outreach is the Future of B2B Sales",
      date: "August 1, 2026",
      readTime: "6 min read",
      summary: "Traditional SaaS CRMs own your data and charge massive markups. Discover why keeping data in SQLite on your disk changes cold email delivery rates and security."
    },
    {
      slug: "sqlite-wal-mode-electron",
      title: "SQLite WAL Mode inside Electron Subprocesses",
      date: "July 18, 2026",
      readTime: "9 min read",
      summary: "Deep dive into how we coordinate parallel database scraper loops using Write-Ahead Logging without blocking the Electron renderer main UI threads."
    }
  ]

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-4xl mx-auto space-y-16"
      >
        {/* Header Block */}
        <div className="space-y-4 max-w-2xl">
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
            Engineering Blog
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Logs
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Technical writing on database performance, local-first protocols, and SMTP routing mechanisms.
          </motion.p>
        </div>

        {/* Posts Grid */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {posts.map((post) => (
            <div 
              key={post.slug}
              className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] flex flex-col justify-between space-y-6 hover:border-[var(--border-strong)] transition-all duration-200"
            >
              <div className="space-y-3 text-left">
                <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--text-tertiary)]">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {post.date}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {post.readTime}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-[var(--foreground)] leading-snug">{post.title}</h2>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{post.summary}</p>
              </div>

              <Link 
                href={`/blog/${post.slug}`} 
                className="inline-flex items-center gap-1 text-xs text-[var(--primary)] font-semibold hover:underline self-start"
              >
                Read Post
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
        </motion.div>

      </motion.div>
    </div>
  )
}
