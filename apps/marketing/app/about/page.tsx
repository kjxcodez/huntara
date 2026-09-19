"use client"

import React from "react"
import { motion } from "motion/react"
import { ShieldCheck, HardDrive, EyeOff } from "lucide-react"

export default function AboutPage() {
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
        className="max-w-3xl mx-auto space-y-16"
      >
        {/* Header Block */}
        <div className="space-y-4">
          <motion.div variants={childVariants} className="text-[10px] font-mono uppercase tracking-wider text-[var(--primary)] font-semibold">
            About Us
          </motion.div>
          <motion.h1 variants={childVariants} className="text-3xl font-semibold tracking-tight text-[var(--foreground)] md:text-4xl leading-tight">
            The Local-First Sales Manifesto
          </motion.h1>
          <motion.p variants={childVariants} className="text-sm text-[var(--text-secondary)] leading-relaxed">
            HUNTARA was built by engineering operators who believe professional software tools should be fast, private, and precise.
          </motion.p>
        </div>

        {/* Manifesto Content */}
        <motion.div variants={childVariants} className="space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-subtle)] pt-8">
          <p>
            For the past decade, sales software has followed a single, multi-tenant cloud template. 
            Companies are told they must upload their entire leads list, email server login API keys, and campaign schedules into remote cloud databases to get outreach results.
          </p>
          <p>
            We believe this cloud-first default is an outdated compromise. With modern hardware, 
            your desktop is more than fast enough to coordinate scraping queries, resolve domain names, and execute campaigns. 
            By keeping data local on your disk inside an SQLite WAL database, you gain:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
            <div className="space-y-2 border border-[var(--border-subtle)] rounded p-4 bg-[var(--card)]">
              <HardDrive className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-xs font-semibold text-[var(--foreground)]">Instant Speed</h2>
              <p className="text-[10px] leading-normal">Sub-millisecond query responses from local SQLite indexes instead of REST API trips.</p>
            </div>
            <div className="space-y-2 border border-[var(--border-subtle)] rounded p-4 bg-[var(--card)]">
              <EyeOff className="h-4 w-4 text-[var(--success)]" />
              <h2 className="text-xs font-semibold text-[var(--foreground)]">Absolute Privacy</h2>
              <p className="text-[10px] leading-normal">No third-party trackers or multi-tenant database leaks. Your keys remain yours.</p>
            </div>
            <div className="space-y-2 border border-[var(--border-subtle)] rounded p-4 bg-[var(--card)]">
              <ShieldCheck className="h-4 w-4 text-[#5B8DEF]" />
              <h2 className="text-xs font-semibold text-[var(--foreground)]">Direct Handshakes</h2>
              <p className="text-[10px] leading-normal">Direct TLS email deliveries from your client system to the mail server relay.</p>
            </div>
          </div>

          <p>
            HUNTARA is built for operators who prioritize execution and craftsmanship over startup hype. We are proud to build it open-source.
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}
