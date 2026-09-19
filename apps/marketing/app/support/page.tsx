"use client"

import React from "react"
import { motion } from "motion/react"
import { HelpCircle, Mail, MessageSquare, Terminal, AlertCircle } from "lucide-react"

export default function SupportPage() {
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
            Support Desk
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            How can we help?
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Get troubleshooting steps for SMTP configurations, SQLite WAL errors, or export local logs directly to developers.
          </motion.p>
        </div>

        {/* Support Grid */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* GitHub Issues */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
            <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--primary)]">
              <Terminal className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">GitHub Issues</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Report code bugs, scraper failures, or suggest new SMTP parameters directly in our repo.
            </p>
            <a
              href="https://github.com/kjxcodez/huntara/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] font-semibold hover:underline"
            >
              Open GitHub Issue
            </a>
          </div>

          {/* Discord Hub */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
            <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[#5B8DEF]">
              <MessageSquare className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Community Discord</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Chat with other operators, share custom enrichment formulas, or troubleshoot config logs in real-time.
            </p>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider block">Invites Coming Soon</span>
          </div>

          {/* GitHub Discussions */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
            <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--success)]">
              <HelpCircle className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">GitHub Discussions</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Ask setup questions, propose new scraping strategies, or share outbound configurations with the community.
            </p>
            <a
              href="https://github.com/kjxcodez/huntara/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] font-semibold hover:underline"
            >
              Open Discussions
            </a>
          </div>

        </motion.div>

        {/* Debug Bundle Guide */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-xl bg-[var(--card)] p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <AlertCircle className="h-4.5 w-4.5 text-[var(--primary)]" />
            Generating a Support Debug Bundle
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            If you are running into scraping loop failures or database checkpoint crashes, you can export a secure debug bundle directly from the diagnostics panel in the desktop application.
            This bundle strips out SMTP credentials and API keys, packaging only system logs and thread queue dumps.
          </p>
          <div className="bg-[var(--background)] border border-[var(--border-subtle)] p-3 rounded font-mono text-[10px] text-[var(--text-secondary)] leading-relaxed">
            <span className="text-[var(--primary)] font-semibold">Location in Desktop App:</span>
            <div className="mt-1 select-all">Settings &gt; Diagnostics &gt; Export Debug Bundle</div>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
