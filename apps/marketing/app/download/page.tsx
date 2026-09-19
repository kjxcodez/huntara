"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { 
  ArrowDownToLine, 
  Monitor, 
  Apple, 
  Terminal, 
  ShieldCheck, 
  Database, 
  Lock, 
  ArrowRight,
  Sparkles
} from "lucide-react"
import { getLatestRelease, PlatformId } from "../../lib/generated-releases"

function PlatformIcon({ id, className }: { id: PlatformId; className?: string }) {
  if (id === "windows") return <Monitor className={className || "h-5 w-5"} />
  if (id === "macos") return <Apple className={className || "h-5 w-5"} />
  return <Terminal className={className || "h-5 w-5"} />
}

export default function DownloadPage() {
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformId>("windows")

  useEffect(() => {
    if (typeof window === "undefined") return
    const platform = window.navigator.platform.toLowerCase()
    const userAgent = window.navigator.userAgent.toLowerCase()

    if (platform.includes("win") || userAgent.includes("windows")) {
      setDetectedPlatform("windows")
    } else if (platform.includes("mac") || userAgent.includes("macintosh")) {
      setDetectedPlatform("macos")
    } else if (platform.includes("linux") || platform.includes("x11")) {
      setDetectedPlatform("linux")
    }
  }, [])

  const latestRelease = getLatestRelease()

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
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <motion.div
            variants={childVariants}
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-lg select-none shrink-0"
          >
            <img src="/app-icon.png" className="h-11 w-11 object-contain" alt="HUNTARA" />
          </motion.div>
          <div className="space-y-2">
            <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
              <Sparkles className="h-3 w-3" />
              Latest Release: {latestRelease.version} · {latestRelease.status === "stable" ? "Stable" : "Active Beta"}
            </motion.div>
            <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
              Get HUNTARA
            </motion.h1>
            <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] max-w-xl">
              Runs locally on your desktop. Dispatches campaigns from your hardware. Secure by default.
            </motion.p>
          </div>
        </div>

        {/* Release Meta Bar */}
        <motion.div variants={childVariants} className="grid grid-cols-2 md:grid-cols-3 gap-4 border border-[var(--border)] rounded-xl p-4 bg-[var(--card)]">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">Available Platforms</span>
            <div className="text-sm font-bold font-mono text-[var(--foreground)]">
              {latestRelease.platforms.map((p) => p.label).join(", ")}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">Release Status</span>
            <div className="text-sm font-bold font-mono text-[var(--success)] flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse"></span>
              {latestRelease.status === "stable" ? "Stable Build" : "Active Beta"}
            </div>
          </div>
          <div className="col-span-2 md:col-span-1 space-y-1">
            <span className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">License</span>
            <div className="text-sm font-bold font-mono text-[var(--foreground)]">MIT Open Source</div>
          </div>
        </motion.div>

        {/* Platform Downloads Cards — Renders ONLY available platforms from latest release */}
        <motion.div variants={childVariants} className="space-y-4">
          <div className="text-xs font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
            Choose Your Platform
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {latestRelease.platforms.map((plat) => {
              const isDetected = detectedPlatform === plat.id
              return (
                <div 
                  key={plat.id}
                  className={`border rounded-xl p-6 bg-[var(--card)] text-left flex flex-col justify-between space-y-6 transition-all duration-200 relative overflow-hidden ${
                    isDetected 
                      ? "border-primary ring-1 ring-primary/40 shadow-[0_0_24px_rgba(250,113,37,0.08)]" 
                      : "border-[var(--border)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  {isDetected && (
                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-[8.5px] font-mono text-primary font-bold uppercase tracking-wider">
                      Your OS
                    </span>
                  )}

                  <div className="space-y-4">
                    <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-primary">
                      <PlatformIcon id={plat.id} className="h-6 w-6" />
                    </div>

                    <div>
                      <h2 className="font-semibold text-base text-[var(--foreground)]">
                        HUNTARA for {plat.label}
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                        Local executable installer with SQLite storage engine.
                      </p>
                    </div>

                    {/* Artifact download buttons */}
                    <div className="space-y-2.5 pt-2">
                      {plat.artifacts.map((art) => (
                        <div key={art.id} className="space-y-1.5">
                          <a 
                            href={art.downloadUrl}
                            className="inline-flex w-full items-center justify-center gap-2 h-9 rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-sm"
                          >
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                            Download for {plat.label} ({art.architectureLabel})
                          </a>
                          <div className="text-[10px] font-mono text-[var(--text-tertiary)] text-center">
                            {art.artifactType} · {art.sizeFormatted}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[var(--border-subtle)]">
                    <Link
                      href={`/releases/${latestRelease.version}/${plat.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      Platform details &amp; checksum <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>

        {/* Previous Releases Archive CTA */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Looking for previous versions or other releases?
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Browse the historical release archive, changelogs, and SHA-256 binary validation hashes.
            </p>
          </div>
          <Link
            href="/releases"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-xs font-semibold text-[var(--foreground)] hover:border-primary/60 transition-colors shrink-0"
          >
            Browse All Releases <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </motion.div>

        {/* Security & Local Isolation Guarantee */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-[var(--border-subtle)]">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <Database className="h-4 w-4 text-primary" />
              Local Storage
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              All databases, contacts, discovery queues, and outreach logs live directly on your hard drive in SQLite files.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <Lock className="h-4 w-4 text-primary" />
              OS-Native Encryption
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Account tokens and mailbox credentials are encrypted via Windows DPAPI or macOS Keychain before write.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Zero Telemetry Leakage
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              No private prospecting lists or customer records are uploaded to central analytics servers.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
