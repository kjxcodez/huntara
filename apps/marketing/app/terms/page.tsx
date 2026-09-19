"use client"

import React from "react"
import { motion } from "motion/react"

export default function TermsPage() {
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
            Terms of Service
          </motion.div>
          <motion.h1 variants={childVariants} className="text-3xl font-semibold tracking-tight text-[var(--foreground)] md:text-4xl">
            Terms of Service &amp; Usage License
          </motion.h1>
          <motion.p variants={childVariants} className="text-xs text-[var(--text-tertiary)] font-mono">
            Last Updated: August 2, 2026
          </motion.p>
        </div>

        <motion.div variants={childVariants} className="space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-subtle)] pt-8">
          <p>
            Please read these terms carefully before installing or launching the HUNTARA client application.
          </p>

          <h2 className="text-sm font-semibold text-[var(--foreground)] font-mono uppercase tracking-wider text-[11px] mt-8">1. License Grant</h2>
          <p>
            HUNTARA is licensed under standard open-source parameters. You are granted the right to install, customize, run, and scale client scrapers and SMTP campaign relays locally on your hardware.
          </p>

          <h2 className="text-sm font-semibold text-[var(--foreground)] font-mono uppercase tracking-wider text-[11px] mt-8">2. Acceptable Use</h2>
          <p>
            You agree to use HUNTARA in compliance with all local laws and regulations (including CAN-SPAM, GDPR, and local scraping compliance regulations). You represent that you own or have permission to connect to all SMTP mailboxes used in your campaigns.
          </p>

          <h2 className="text-sm font-semibold text-[var(--foreground)] font-mono uppercase tracking-wider text-[11px] mt-8">3. Limitation of Liability</h2>
          <p>
            HUNTARA is provided &ldquo;as is&rdquo;, without warranty of any kind. In no event shall the authors or copyright holders be liable for any claims, damages, or liabilities arising from the use of the scraping tools or direct campaign SMTP handshakes.
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}
