"use client"

import React from "react"
import { motion } from "motion/react"
import { Check, ShieldAlert, Zap, Globe, Cpu } from "lucide-react"

export default function PricingPage() {
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

  const features = [
    "Unlimited Google Maps Scraper",
    "Multi-process Headless Worker Host",
    "LinkedIn Voyager API Integration",
    "TLS Handshake Direct SMTP Relay",
    "Local SQLite WAL Storage (Workspace isolated)",
    "Diagnostics telemetry dashboard"
  ]

  const roadmapPlans = [
    {
      name: "Hybrid Cloud Backups",
      description: "Encrypted delta updates syncing local databases to remote relays for team collaboration.",
      stage: "Planned"
    },
    {
      name: "Third-Party Verification",
      description: "Direct plugin integrations for email checking services like Hunter, ZeroBounce, etc.",
      stage: "Planned"
    }
  ]

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-5xl mx-auto space-y-16"
      >
        {/* Header Block */}
        <div className="space-y-4 max-w-2xl">
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border border-[rgba(63,178,127,0.2)] text-[10px] uppercase tracking-wider font-mono">
            Free Open Beta
          </motion.div>
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            Free while in beta.
          </h1>
          <p className="text-base text-[var(--text-secondary)]">
            HUNTARA runs on your hardware. We do not charge bloated cloud hosting markups because you run the system yourself.
          </p>
        </div>

        {/* Pricing Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Beta Tier Card */}
          <motion.div 
            variants={childVariants}
            className="lg:col-span-2 border border-[var(--primary)] ring-1 ring-[var(--primary)] rounded-lg p-6 bg-[var(--card)] space-y-6 flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">HUNTARA Open Beta</h2>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    Complete local-first pipeline environment running locally inside your system container.
                  </p>
                </div>
                <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--primary)] px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
                  Active
                </span>
              </div>
              <div className="text-4xl font-bold font-mono text-[var(--foreground)]">
                $0
                <span className="text-xs font-normal text-[var(--text-tertiary)]"> / free forever during beta</span>
              </div>

              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-6 text-[11.5px] text-[var(--text-secondary)]">
                {features.map((feat) => (
                  <li key={feat} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-[var(--primary)] shrink-0" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-4">
              <a 
                href="/download"
                className="inline-flex w-full h-10 items-center justify-center rounded bg-[var(--primary)] text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all cursor-pointer"
              >
                Download Windows Installer (v1.0.0-beta.1)
              </a>
            </div>
          </motion.div>

          {/* Roadmap Info Card */}
          <motion.div 
            variants={childVariants}
            className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] flex flex-col justify-between"
          >
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
                <Globe className="h-4 w-4 text-[var(--text-tertiary)]" /> Future Extensions
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                As we build team collaboration modules, we will introduce optional paid cloud hosting services. The core desktop app remains local and free.
              </p>

              <div className="border-t border-[var(--border-subtle)] pt-4 space-y-4">
                {roadmapPlans.map((plan) => (
                  <div key={plan.name} className="space-y-1 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--foreground)]">{plan.name}</span>
                      <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded border bg-[var(--secondary)] text-[var(--muted-foreground)] border-[var(--border-subtle)]">
                        {plan.stage}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-tertiary)] leading-normal">
                      {plan.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-6">
              <a
                href="/roadmap"
                className="inline-flex w-full h-9 items-center justify-center rounded border border-[var(--border)] bg-[var(--background)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)] transition-all"
              >
                Review Development Roadmap
              </a>
            </div>
          </motion.div>

        </div>

        {/* Local Security block */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-xl bg-[var(--card)] p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
              <ShieldAlert className="h-4.5 w-4.5 text-[var(--primary)]" />
              100% Offline Portability
            </h2>
            <p className="text-xs text-[var(--text-secondary)] max-w-xl leading-relaxed">
              Your SQLite database tables sit safely on your machine. Even if you choose not to subscribe to future cloud layers, your campaigns, indexes, and logs are 100% accessible forever.
            </p>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
