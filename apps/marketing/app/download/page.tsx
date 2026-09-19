"use client"

import React, { useState, useEffect } from "react"
import { motion, useInView } from "motion/react"
import { ArrowDownToLine, Monitor, Apple, Terminal, ShieldAlert, Cpu, HardDrive, RefreshCw } from "lucide-react"
import { GENERATED_RELEASES } from "../../lib/generated-releases"

function AnimatedCounter({ value, duration = 1.5 }: { value: number; duration?: number }) {
  const [count, setCount] = useState(0)
  const ref = React.useRef(null)
  const isInView = useInView(ref, { once: true })

  useEffect(() => {
    if (!isInView) return
    let start = 0
    const end = value
    const totalSteps = (duration * 1000) / 30
    const stepIncrement = end / totalSteps
    
    const timer = setInterval(() => {
      start += stepIncrement
      if (start >= end) {
        clearInterval(timer)
        setCount(end)
      } else {
        setCount(Math.floor(start))
      }
    }, 30)

    return () => clearInterval(timer)
  }, [value, duration, isInView])

  return <span ref={ref}>{count.toLocaleString()}</span>
}

export default function DownloadPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<"win" | "mac" | "linux">("win")

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

  // Find latest stable vs. latest pre-release
  const latestRelease = GENERATED_RELEASES.find(r => !r.prerelease) || GENERATED_RELEASES[0]
  
  // Find assets
  const winAsset = latestRelease.assets.find(a => a.name.endsWith('.exe'))
  const macAsset = latestRelease.assets.find(a => a.name.endsWith('.dmg'))
  const linuxAsset = latestRelease.assets.find(a => a.name.endsWith('.AppImage'))

  const formatSize = (bytes?: number) => {
    if (!bytes) return "Unknown size"
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="container mx-auto px-6 py-20 min-h-[80vh] text-left">
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
            className="flex h-16 w-16 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--card)] shadow-[0_4px_24px_rgba(0,0,0,0.3)] select-none shrink-0"
          >
            <img src="/app-icon.png" className="h-11 w-11 object-contain" alt="HUNTARA" />
          </motion.div>
          <div className="space-y-2">
            <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
              Release {latestRelease.version} · {latestRelease.prerelease ? "Beta" : "Stable"}
            </motion.div>
            <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
              Get HUNTARA
            </motion.h1>
            <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] max-w-xl">
              Runs locally on your desktop. Dispatches campaigns from your hardware. Secure by default.
            </motion.p>
          </div>
        </div>

        {/* Counter and Status */}
        <motion.div variants={childVariants} className="grid grid-cols-2 md:grid-cols-3 gap-4 border border-[var(--border)] rounded-lg p-4 bg-[var(--card)]">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">Platform Support</span>
            <div className="text-sm font-bold font-mono text-[var(--foreground)]">
              Windows (x64)
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">Build Status</span>
            <div className="text-sm font-bold font-mono text-[var(--success)] flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse"></span>
              Active Beta
            </div>
          </div>
          <div className="col-span-2 md:col-span-1 space-y-1">
            <span className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">License</span>
            <div className="text-sm font-bold font-mono text-[var(--foreground)]">Open Source (MIT)</div>
          </div>
        </motion.div>

        {/* Platform Selection Cards */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Windows Card */}
          <div 
            onClick={() => setSelectedPlatform("win")}
            className={`border rounded-lg p-5 cursor-pointer bg-[var(--card)] transition-all duration-200 text-left flex flex-col justify-between min-h-[200px] ${
              selectedPlatform === "win" ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded bg-[var(--background)] border border-[var(--border)]">
                  <Monitor className="h-5 w-5 text-[var(--primary)]" />
                </div>
                <span className="text-[10px] font-mono text-[var(--text-tertiary)]">{winAsset ? formatSize(winAsset.sizeBytes) : "x64 / ARM64"}</span>
              </div>
              <h2 className="font-semibold text-sm text-[var(--foreground)]">Windows</h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1 mb-4 leading-normal">
                Installer (.exe) supporting Win 10, 11+ with SQLite WAL support.
              </p>
            </div>
            {winAsset ? (
              <a 
                href={winAsset.downloadUrl}
                className="inline-flex w-full items-center justify-center gap-2 h-9 rounded bg-[var(--primary)] text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Download Installer
              </a>
            ) : (
              <button className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] text-xs font-medium text-[var(--text-secondary)] cursor-not-allowed">
                Not Available
              </button>
            )}
          </div>

          {/* macOS Card */}
          <div 
            onClick={() => setSelectedPlatform("mac")}
            className={`border rounded-lg p-5 cursor-pointer bg-[var(--card)] transition-all duration-200 text-left flex flex-col justify-between min-h-[200px] ${
              selectedPlatform === "mac" ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded bg-[var(--background)] border border-[var(--border)]">
                  <Apple className="h-5 w-5 text-[var(--foreground)]" />
                </div>
                <span className="text-[10px] font-mono text-[var(--text-tertiary)]">{macAsset ? formatSize(macAsset.sizeBytes) : "Apple / Intel"}</span>
              </div>
              <h2 className="font-semibold text-sm text-[var(--foreground)]">macOS</h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1 mb-4 leading-normal">
                Disk Image (.dmg) code-signed for M1/M2/M3 &amp; Intel processors.
              </p>
            </div>
            {macAsset ? (
              <a 
                href={macAsset.downloadUrl}
                className="inline-flex w-full items-center justify-center gap-2 h-9 rounded bg-[var(--primary)] text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Download DMG
              </a>
            ) : (
              <button className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] text-xs font-medium text-[var(--text-secondary)] cursor-not-allowed">
                Notify on Release (Beta)
              </button>
            )}
          </div>

          {/* Linux Card */}
          <div 
            onClick={() => setSelectedPlatform("linux")}
            className={`border rounded-lg p-5 cursor-pointer bg-[var(--card)] transition-all duration-200 text-left flex flex-col justify-between min-h-[200px] ${
              selectedPlatform === "linux" ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded bg-[var(--background)] border border-[var(--border)]">
                  <Terminal className="h-5 w-5 text-[var(--text-secondary)]" />
                </div>
                <span className="text-[10px] font-mono text-[var(--text-tertiary)]">{linuxAsset ? formatSize(linuxAsset.sizeBytes) : "AppImage / deb"}</span>
              </div>
              <h2 className="font-semibold text-sm text-[var(--foreground)]">Linux</h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1 mb-4 leading-normal">
                AppImage bundle for Debian, Ubuntu, and Fedora systems.
              </p>
            </div>
            {linuxAsset ? (
              <a 
                href={linuxAsset.downloadUrl}
                className="inline-flex w-full items-center justify-center gap-2 h-9 rounded bg-[var(--primary)] text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Download AppImage
              </a>
            ) : (
              <button className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] text-xs font-medium text-[var(--text-secondary)] cursor-not-allowed">
                Notify on Release (Beta)
              </button>
            )}
          </div>
        </motion.div>

        {/* Checksums Details */}
        <motion.div variants={childVariants} className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Verify Checksums</h2>
          <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--card)] font-mono text-[10px] text-[var(--text-secondary)] space-y-2 overflow-x-auto leading-relaxed">
            {winAsset && (
              <div>
                <span className="text-[var(--primary)] font-semibold">SHA-256 (Windows x64):</span>
                <div className="bg-[var(--background)] p-2 rounded border border-[var(--border-subtle)] mt-1 select-all">
                  {winAsset.checksum}
                </div>
              </div>
            )}
            {macAsset && (
              <div>
                <span className="text-[var(--foreground)] font-semibold">SHA-256 (macOS dmg):</span>
                <div className="bg-[var(--background)] p-2 rounded border border-[var(--border-subtle)] mt-1 select-all">
                  {macAsset.checksum}
                </div>
              </div>
            )}
            {linuxAsset && (
              <div>
                <span className="text-[var(--foreground)] font-semibold">SHA-256 (Linux AppImage):</span>
                <div className="bg-[var(--background)] p-2 rounded border border-[var(--border-subtle)] mt-1 select-all">
                  {linuxAsset.checksum}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* System Requirements */}
        <motion.div variants={childVariants} className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">System Requirements</h2>
          <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
            <table className="w-full border-collapse text-xs text-left">
              <thead>
                <tr className="bg-[var(--muted)] text-[10px] uppercase font-mono text-[var(--text-tertiary)] border-b border-[var(--border)]">
                  <th className="px-4 py-2 font-normal">Component</th>
                  <th className="px-4 py-2 font-normal">Minimum</th>
                  <th className="px-4 py-2 font-normal">Recommended</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-secondary)]">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-[var(--foreground)]">OS</td>
                  <td className="px-4 py-2.5">Windows 10 Pro (x64)</td>
                  <td className="px-4 py-2.5">Windows 11 (x64)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-medium text-[var(--foreground)]">Memory</td>
                  <td className="px-4 py-2.5">4 GB RAM</td>
                  <td className="px-4 py-2.5">8 GB RAM (recommended for WAL indexing)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-medium text-[var(--foreground)]">Storage</td>
                  <td className="px-4 py-2.5">250 MB free space</td>
                  <td className="px-4 py-2.5">1 GB+ (SSD for scraping databases)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
