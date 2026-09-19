"use client"

import React from "react"
import { motion } from "motion/react"
import { Users, Terminal, MessageSquare, Heart } from "lucide-react"

export default function CommunityPage() {
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
            Operator Hub
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Community
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Collaborate with other local-first operators, share scrapers, or help shape the future of HUNTARA.
          </motion.p>
        </div>

        {/* Community Channels Grid */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* GitHub Discussions */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
            <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--primary)]">
              <Terminal className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">GitHub Discussions</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Ask architectural questions, propose feature changes, or share custom parsing scripts.
            </p>
            <a
              href="https://github.com/kjxcodez/huntara/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] font-semibold hover:underline"
            >
              Join Discussion
            </a>
          </div>

          {/* Discord Server */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
            <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[#5B8DEF]">
              <MessageSquare className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Operator Discord</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Talk directly to the creators, get help with SMTP tls settings, or chat with active users.
            </p>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider block">Invites Coming Soon</span>
          </div>

          {/* Open Contributions */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
            <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--success)]">
              <Heart className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Open Contributors</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Submit code PRs, update documentation translations, or design visual layouts.
            </p>
            <a href="/open-source" className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] font-semibold hover:underline">
              Learn How to Contribute
            </a>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
