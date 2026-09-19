"use client"

import React from "react"
import { motion } from "motion/react"
import { ArrowDownToLine, Monitor, Apple, Terminal, ShieldCheck, ChevronRight } from "lucide-react"
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

  const formatSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
            Release Distribution
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            Releases Repository
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Archive of stable and previous builds of HUNTARA. Verify assets using checksum digests.
          </motion.p>
        </div>

        {/* Releases Timeline */}
        <motion.div variants={childVariants} className="space-y-8">
          {GENERATED_RELEASES.map((rel) => (
            <div key={rel.version} className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-6">
              {/* Release Header */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-semibold text-[var(--foreground)] font-mono">{rel.version}</h3>
                  <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    !rel.prerelease 
                      ? "bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border-[rgba(63,178,127,0.2)]" 
                      : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  }`}>
                    {rel.prerelease ? "Pre-release" : "Stable"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--text-tertiary)]">
                  <span>Released {formatDate(rel.releaseDate)}</span>
                </div>
              </div>

              {/* Release Notes */}
              {rel.releaseNotes && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-tertiary)] font-semibold">Changelog</div>
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed space-y-2 prose max-w-none">
                    <pre className="whitespace-pre-wrap font-sans text-xs bg-[rgba(10,10,11,0.2)] border border-[var(--border-subtle)] p-3 rounded-md text-[var(--text-secondary)] leading-relaxed">
                      {rel.releaseNotes}
                    </pre>
                  </div>
                </div>
              )}

              {/* Assets list */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-tertiary)] font-semibold">Downloadable Artifacts</div>
                <div className="space-y-2">
                  {rel.assets.length > 0 ? (
                    rel.assets.map((asset) => {
                      const IconComp = asset.platform.includes("Windows") 
                        ? Monitor 
                        : asset.platform.includes("macOS") 
                        ? Apple 
                        : Terminal
                      
                      return (
                        <div key={asset.name} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs bg-[var(--background)] border border-[var(--border-subtle)] rounded p-2.5 gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <IconComp className="h-4 w-4 text-[var(--text-secondary)] shrink-0" />
                            <div className="min-w-0">
                              <span className="font-mono text-[11px] text-[var(--foreground)] truncate block">
                                {asset.name}
                              </span>
                              <div className="flex items-center gap-2 text-[9px] text-[var(--text-tertiary)] font-mono mt-0.5">
                                <span>{formatSize(asset.sizeBytes)}</span>
                                <span>•</span>
                                <span>{asset.platform}</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <span 
                              title={`SHA-256: ${asset.checksum}`} 
                              className="inline-flex items-center gap-1 text-[9px] font-mono text-[var(--text-tertiary)] bg-[var(--card)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]"
                            >
                              <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
                              {asset.checksum.slice(0, 8)}...
                            </span>
                            <a 
                              href={asset.downloadUrl}
                              className="inline-flex h-7 items-center justify-center rounded bg-[var(--primary)] px-3 text-[10px] font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all gap-1 cursor-pointer"
                            >
                              <ArrowDownToLine className="h-3 w-3" />
                              Download
                            </a>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="text-xs text-[var(--text-tertiary)] italic">No assets available for this release.</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  )
}
