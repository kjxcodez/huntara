"use client"

import React from "react"
import { motion } from "motion/react"

export default function PrivacyPage() {
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
        className="max-w-3xl mx-auto space-y-8"
      >
        <div className="space-y-4">
          <motion.div variants={childVariants} className="text-[10px] font-mono uppercase tracking-wider text-[var(--primary)] font-semibold">
            Privacy Policy
          </motion.div>
          <motion.h1 variants={childVariants} className="text-3xl font-semibold tracking-tight text-[var(--foreground)] md:text-4xl">
            Privacy Policy &amp; Data Guidelines
          </motion.h1>
          <motion.p variants={childVariants} className="text-xs text-[var(--text-tertiary)] font-mono">
            Last Updated: August 2, 2026
          </motion.p>
        </div>

        <motion.div variants={childVariants} className="space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-subtle)] pt-8">
          <p>
            This Privacy Policy explains how HUNTARA manages information. Because HUNTARA is a local-first application, the fundamental design principle is that **your data belongs on your own hardware**.
          </p>

          <h2 className="text-sm font-semibold text-[var(--foreground)] font-mono uppercase tracking-wider text-[11px] mt-8">1. Information Gathered Locally</h2>
          <p>
            All lead scraping lists, target SMTP credentials, email histories, notes, and outreach parameters are saved locally in SQLite databases inside your user configuration directories. We do not transmit this data to our systems.
          </p>

          <h2 className="text-sm font-semibold text-[var(--foreground)] font-mono uppercase tracking-wider text-[11px] mt-8">2. Sync Backup Relays</h2>
          <p>
            If you opt into our Hybrid Sync plan (Pro or Enterprise), your local SQLite databases are synced to an encrypted cloud backup relay to support backups and cross-device sync. Credentials are encrypted on-client with AES-256 before synchronization, meaning our relay nodes cannot read your SMTP credentials or email content.
          </p>

          <h2 className="text-sm font-semibold text-[var(--foreground)] font-mono uppercase tracking-wider text-[11px] mt-8">3. Contacting Us</h2>
          <p>
            If you have questions about this privacy protocol, you can reach out via our GitHub repository or support channels.
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}
