"use client"

import React from "react"
import { motion } from "motion/react"
import { ShieldCheck, Database, Key, Check } from "lucide-react"

export default function SecurityPage() {
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

  const securityPoints = [
    {
      title: "Encrypted Local Senders Store",
      icon: Key,
      description: "SMTP passwords and key API secrets are stored locally on-disk. They are encrypted using AES-256-GCM, with keys managed by the OS Keychain (Windows Credential Manager / macOS Keychain). They never traverse our network."
    },
    {
      title: "SQLite Database WAL Locks",
      icon: Database,
      description: "Your CRM columns, scraper lists, and verified contacts sit strictly in standard SQLite databases on your hard drive. There is no cloud multi-tenant database exposing your prospect pipelines."
    },
    {
      title: "No Middleman Outbound Dispatch",
      icon: ShieldCheck,
      description: "Direct TLS handshakes are established from your physical client CPU to your mail servers (Office365, Google Workspace, custom SMTP). Your messages do not go through our cloud servers."
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
            Compliance Protocols
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            Security &amp; Data Ownership
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            HUNTARA is designed with local-first parameters. Your data remains yours.
          </motion.p>
        </div>

        {/* Security Cards */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {securityPoints.map((point) => {
            const IconComp = point.icon
            return (
              <div key={point.title} className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all">
                <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--primary)]">
                  <IconComp className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-semibold text-[var(--foreground)] leading-snug">{point.title}</h2>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{point.description}</p>
              </div>
            )
          })}
        </motion.div>

        {/* Security Compliance Statement */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] space-y-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Security FAQ Summary</h2>
          <ul className="text-xs text-[var(--text-secondary)] space-y-3 leading-relaxed">
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-[var(--primary)] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[var(--foreground)]">Does HUNTARA have access to my SMTP credentials?</strong>
                <p className="mt-0.5">No. SMTP keys are decrypted in memory only at the time of campaign execution, and the handshake certificates occur directly from your system.</p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-[var(--primary)] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[var(--foreground)]">Can I export my databases?</strong>
                <p className="mt-0.5">Yes. Because data is saved in a standard SQLite file, you can copy or export the `.db` files at any time, allowing total access without vendor locks.</p>
              </div>
            </li>
          </ul>
        </motion.div>

      </motion.div>
    </div>
  )
}
