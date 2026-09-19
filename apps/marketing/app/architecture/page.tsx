"use client"

import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Cpu, HardDrive, RefreshCw, Layers, ShieldCheck, Activity, Zap } from "lucide-react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"

export default function ArchitecturePage() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [activeSync, setActiveSync] = useState(true)
  const [pulseCount, setPulseCount] = useState(0)

  useEffect(() => {
    if (prefersReducedMotion || !activeSync) return
    const interval = setInterval(() => {
      setPulseCount((prev) => prev + 1)
    }, 2200)
    return () => clearInterval(interval)
  }, [activeSync, prefersReducedMotion])

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  }

  const childVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } }
  }

  return (
    <div className="container mx-auto px-6 py-20 min-h-[90vh] text-left relative overflow-hidden">
      
      {/* Subtle Background Drifting Field */}
      {!prefersReducedMotion && (
        <div className="absolute inset-0 -z-10 pointer-events-none opacity-[0.02] bg-[radial-gradient(#FA7125_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] animate-pulse" style={{ animationDuration: '8s' }} />
      )}

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-5xl mx-auto space-y-16"
      >
        {/* Title */}
        <div className="space-y-4 max-w-2xl">
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
            System Topology
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            Local-First Architecture
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            HUNTARA runs on your hardware, stores data locally in SQLite, and communicates directly with SMTP relays, using cloud synchronizers only for backups and remote tasks.
          </motion.p>
        </div>

        {/* Dynamic Topology Canvas Block */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-xl bg-[var(--card)] p-6 md:p-8 relative">
          <div className="flex items-center justify-between mb-8 select-none">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75 ${activeSync ? "animate-ping" : ""}`}></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--success)]"></span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Local Handshake Handlers
              </span>
            </div>
            <button 
              onClick={() => setActiveSync(!activeSync)}
              className="px-3 h-7 rounded border border-[var(--border)] bg-[var(--background)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)] flex items-center gap-1.5 transition-all duration-150 cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${activeSync && !prefersReducedMotion ? "animate-spin" : ""}`} />
              {activeSync ? "Live Handshake active" : "Handshake Paused"}
            </button>
          </div>

          {/* SVG Diagram Canvas */}
          <div className="relative w-full h-[220px] md:h-[260px] flex items-center justify-center">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 240" fill="none">
              {/* Paths */}
              <path id="path1" d="M150 120 H 350" stroke="var(--border)" strokeWidth="2" strokeDasharray="6 6" />
              <path id="path2" d="M450 120 H 650" stroke="var(--border)" strokeWidth="2" strokeDasharray="6 6" />

              {/* Pulsing Connector Dashes */}
              {activeSync && !prefersReducedMotion && (
                <>
                  <circle r="4" fill="var(--primary)">
                    <animateMotion dur="2.2s" repeatCount="indefinite" path="M150 120 H 350" />
                  </circle>
                  <circle r="4" fill="#3FB27F">
                    <animateMotion dur="2.2s" repeatCount="indefinite" path="M450 120 H 650" />
                  </circle>
                </>
              )}
            </svg>

            {/* Topology Nodes Grid */}
            <div className="absolute inset-0 flex justify-between items-center px-4 md:px-12 select-none pointer-events-none">
              
              {/* Scraper / Client */}
              <div className="flex flex-col items-center space-y-3 z-10 w-28 bg-[var(--card)] p-3 border border-[var(--border-subtle)] rounded-lg">
                <div className="p-3 bg-[var(--background)] rounded-full border border-[var(--border)]">
                  <Cpu className="h-6 w-6 text-[var(--text-secondary)]" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-semibold text-[var(--foreground)]">Local CPU</div>
                  <div className="text-[9px] text-[var(--text-tertiary)] font-mono uppercase mt-0.5">Scraper Engine</div>
                </div>
              </div>

              {/* SQLite WAL Storage */}
              <div className="flex flex-col items-center space-y-3 z-10 w-32 bg-[var(--card)] p-3 border border-[var(--primary)] rounded-lg shadow-[0_4px_24px_rgba(250,113,37,0.04)]">
                <div className="p-3 bg-[var(--background)] rounded-full border border-[var(--primary)]">
                  <HardDrive className="h-6 w-6 text-[var(--primary)]" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-semibold text-[var(--foreground)]">SQLite WAL</div>
                  <div className="text-[9px] text-[var(--primary)] font-mono uppercase mt-0.5">Local Storage</div>
                </div>
              </div>

              {/* Cloud Backup API */}
              <div className="flex flex-col items-center space-y-3 z-10 w-28 bg-[var(--card)] p-3 border border-[var(--border-subtle)] rounded-lg relative">
                <span className="absolute -top-2 right-2 px-1.5 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-[7px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
                  Planned
                </span>
                <div className="p-3 bg-[var(--background)] rounded-full border border-[var(--border)]">
                  <Layers className="h-6 w-6 text-[var(--text-secondary)]" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-semibold text-[var(--foreground)]">Cloud Relay</div>
                  <div className="text-[9px] text-[var(--text-tertiary)] font-mono uppercase mt-0.5">Encrypted Sync</div>
                </div>
              </div>

            </div>
          </div>
        </motion.div>

        {/* Explainers Grid */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4.5 w-4.5 text-[var(--primary)]" />
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Why Desktop First?</h2>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Scraping google maps, scraping WHOIS directories, and crawling sites for contacts is highly CPU intensive. Cloud hosts charge premiums for this; your desktop runs it essentially free.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4.5 w-4.5 text-[var(--success)]" />
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Data Ownership</h2>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Your database sits directly in standard `.db` structures on your hard drive. Your SMTP password keys and target credentials are never sent to third-party databases.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-[#5B8DEF]" />
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Hybrid Synchronizer</h2>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              When online, the HUNTARA Sync Engine handles remote outbound dispatch queue synchronizations. If you go offline, jobs pause locally and resume seamlessly without data losses.
            </p>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
