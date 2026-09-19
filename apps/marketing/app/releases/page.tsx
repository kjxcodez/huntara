"use client"

import React from "react"
import { motion } from "motion/react"
import { ArrowDownToLine, Monitor, Apple, Terminal } from "lucide-react"
import { GENERATED_RELEASES } from "../../lib/generated-releases"

export default function ReleasesPage() {
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    })
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
            Release History
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Releases
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Download the official releases of HUNTARA for Windows, macOS, and Linux. Find the companies worth selling to.
          </motion.p>
        </div>

        {/* Releases Timeline */}
        <motion.div variants={childVariants} className="space-y-10">
          {GENERATED_RELEASES.map((rel) => {
            const winAsset = rel.assets.find(a => a.platform === 'Windows' || a.name.endsWith('.exe'))
            const macAsset = rel.assets.find(a => a.platform === 'macOS' || a.name.endsWith('.dmg') || a.name.endsWith('.zip'))
            const linuxAsset = rel.assets.find(a => a.platform === 'Linux' || a.name.endsWith('.AppImage'))

            return (
              <div key={rel.version} className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] space-y-6">
                {/* Release Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-[var(--foreground)] font-mono">
                      HUNTARA {rel.version}
                    </h2>
                    <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${
                      !rel.prerelease 
                        ? "bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border-[rgba(63,178,127,0.2)]" 
                        : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    }`}>
                      {rel.prerelease ? "Pre-release" : "Stable"}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-[var(--text-tertiary)]">
                    Released {formatDate(rel.releaseDate)}
                  </div>
                </div>

                {/* Release Notes */}
                {rel.releaseNotes && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-tertiary)] font-semibold">
                      Release Notes
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] leading-relaxed bg-[rgba(10,10,11,0.25)] border border-[var(--border-subtle)] p-4 rounded-lg whitespace-pre-wrap font-sans">
                      {rel.releaseNotes}
                    </div>
                  </div>
                )}

                {/* Platform Downloads Cards */}
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-tertiary)] font-semibold">
                    Downloads
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Windows */}
                    <div className="border border-[var(--border-subtle)] rounded-lg p-4 bg-[var(--background)] flex flex-col justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Monitor className="h-5 w-5 text-white shrink-0" />
                        <div>
                          <div className="text-xs font-semibold text-white">Windows</div>
                          <div className="text-[10px] text-[var(--text-tertiary)]">HUNTARA for Windows</div>
                        </div>
                      </div>
                      {winAsset ? (
                        <a
                          href={winAsset.downloadUrl}
                          className="inline-flex h-8 items-center justify-center rounded bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all gap-1.5 cursor-pointer"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          Download for Windows
                        </a>
                      ) : (
                        <div className="inline-flex h-8 items-center justify-center rounded bg-zinc-800/60 px-3 text-[11px] font-medium text-zinc-500 cursor-not-allowed">
                          Coming soon
                        </div>
                      )}
                    </div>

                    {/* macOS */}
                    <div className="border border-[var(--border-subtle)] rounded-lg p-4 bg-[var(--background)] flex flex-col justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Apple className="h-5 w-5 text-white shrink-0" />
                        <div>
                          <div className="text-xs font-semibold text-white">macOS</div>
                          <div className="text-[10px] text-[var(--text-tertiary)]">HUNTARA for macOS</div>
                        </div>
                      </div>
                      {macAsset ? (
                        <a
                          href={macAsset.downloadUrl}
                          className="inline-flex h-8 items-center justify-center rounded bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all gap-1.5 cursor-pointer"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          Download for macOS
                        </a>
                      ) : (
                        <div className="inline-flex h-8 items-center justify-center rounded bg-zinc-800/60 px-3 text-[11px] font-medium text-zinc-500 cursor-not-allowed">
                          Coming soon
                        </div>
                      )}
                    </div>

                    {/* Linux */}
                    <div className="border border-[var(--border-subtle)] rounded-lg p-4 bg-[var(--background)] flex flex-col justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Terminal className="h-5 w-5 text-white shrink-0" />
                        <div>
                          <div className="text-xs font-semibold text-white">Linux</div>
                          <div className="text-[10px] text-[var(--text-tertiary)]">HUNTARA for Linux</div>
                        </div>
                      </div>
                      {linuxAsset ? (
                        <a
                          href={linuxAsset.downloadUrl}
                          className="inline-flex h-8 items-center justify-center rounded bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all gap-1.5 cursor-pointer"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          Download for Linux
                        </a>
                      ) : (
                        <div className="inline-flex h-8 items-center justify-center rounded bg-zinc-800/60 px-3 text-[11px] font-medium text-zinc-500 cursor-not-allowed">
                          Coming soon
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </motion.div>
      </motion.div>
    </div>
  )
}
