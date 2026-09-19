"use client"

import React, { useEffect, useState } from "react"
import { motion } from "motion/react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
import { Monitor, Apple, Terminal, Clipboard, Check, HelpCircle, ArrowDown } from "lucide-react"
import { GENERATED_RELEASES } from "../lib/generated-releases"
import { SparklesCore } from "./ui/sparkles"

export function Downloads() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [detectedPlatform, setDetectedPlatform] = useState<"win" | "mac" | "linux">("win")
  const [copiedText, setCopiedText] = useState(false)
  const [activeVerifyTab, setActiveVerifyTab] = useState<"win" | "mac" | "linux">("win")

  // Platform detection logic on client mount
  useEffect(() => {
    if (typeof window === "undefined") return
    const platform = window.navigator.platform.toLowerCase()
    const userAgent = window.navigator.userAgent.toLowerCase()
    
    if (platform.includes("win") || userAgent.includes("windows")) {
      setDetectedPlatform("win")
      setActiveVerifyTab("win")
    } else if (platform.includes("mac") || userAgent.includes("macintosh")) {
      setDetectedPlatform("mac")
      setActiveVerifyTab("win") // default verify tab to win since it's the only one available
    } else if (platform.includes("linux") || platform.includes("x11")) {
      setDetectedPlatform("linux")
      setActiveVerifyTab("win") // default verify tab to win
    }
  }, [])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedText(true)
    setTimeout(() => setCopiedText(false), 2000)
  }

  // Find latest stable vs. latest pre-release
  const latestRelease = GENERATED_RELEASES.find(r => !r.prerelease) || GENERATED_RELEASES[0]
  const winAsset = latestRelease?.assets.find(a => a.name.endsWith('.exe'))
  
  const winName = winAsset?.name || "HUNTARA-0.1.2-beta.1-win-x64.exe"
  const winHash = winAsset?.checksum || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  const winUrl = winAsset?.downloadUrl || "https://github.com/kjxcodez/leadforge-os/releases/download/v1.0.0-beta.1/HUNTARA-0.1.2-beta.1-win-x64.exe"
  const winVersion = latestRelease?.version || "v1.0.0-beta.1"

  const checksumData = {
    win: {
      filename: winName,
      hash: winHash,
      cmd: `certutil -hashfile ${winName} SHA256`
    },
    mac: {
      filename: "HUNTARA-macOS (Coming Soon)",
      hash: "Not Available Yet",
      cmd: "echo 'macOS release is planned'"
    },
    linux: {
      filename: "HUNTARA-Linux (Coming Soon)",
      hash: "Not Available Yet",
      cmd: "echo 'Linux release is planned'"
    }
  }

  return (
    <section id="downloads" className="py-24 border-t border-[var(--border-subtle)] bg-[#09090B] relative overflow-hidden lg:px-32 md:px-20 px-4">
      {/* Background radial glow */}
      <div className="absolute bottom-[5%] left-[10%] w-[300px] h-[300px] bg-primary/5 rounded-full blur-[90px] pointer-events-none" />

      {/* Sparkles Particle Backdrop */}
      {!prefersReducedMotion && (
        <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
          <SparklesCore
            id="tsparticlesdownloads"
            background="transparent"
            minSize={0.6}
            maxSize={1.5}
            particleDensity={40}
            className="w-full h-full opacity-35"
            particleColor="#FA7125"
          />
        </div>
      )}

      <div className="container mx-auto px-6 relative z-10">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-16 text-left">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
            <ArrowDown className="h-3.5 w-3.5 text-[var(--primary)]" />
            Signed Releases
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4 md:text-4xl">
            Get HUNTARA
          </h2>
          <p className="text-[var(--text-secondary)] leading-relaxed text-xs sm:text-sm">
            Signed binaries cryptographically checked on every package push. Detects platform architecture instantly.
          </p>
        </div>

        {/* Download Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 select-none">
          
          {/* Windows (Active platform) */}
          <div
            className={`flex flex-col justify-between rounded-lg border bg-[rgba(10,10,12,0.5)] p-6 text-center transition-all duration-200 relative overflow-hidden ${
              detectedPlatform === "win" 
                ? "border-primary/50 shadow-[0_0_20px_rgba(250,113,37,0.06)] scale-[1.01]" 
                : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
            }`}
          >
            <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-[8.5px] font-mono text-primary font-bold uppercase tracking-wider">
              Recommended
            </span>
            <div>
              <Monitor className="h-8 w-8 mx-auto mb-5 text-white" />
              <h4 className="text-sm font-bold text-white mb-1">Windows OS</h4>
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">{winVersion} · x64 Installer</div>
            </div>
            
            <div>
              <a 
                href={winUrl} 
                className="inline-flex w-full h-9 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:bg-opacity-90 transition-all duration-150"
              >
                Download (.exe)
              </a>
              <p className="text-[9px] text-[var(--text-tertiary)] mt-3 font-mono">Silent Installer</p>
            </div>
          </div>

          {/* macOS OS (Coming Soon) */}
          <div
            className="flex flex-col justify-between rounded-lg border bg-[rgba(10,10,12,0.3)] p-6 text-center border-[var(--border-subtle)] opacity-70 relative overflow-hidden"
          >
            <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[8.5px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
              Coming Soon
            </span>
            <div>
              <Apple className="h-8 w-8 mx-auto mb-5 text-zinc-500" />
              <h4 className="text-sm font-bold text-zinc-400 mb-1">macOS OS</h4>
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">Planned · Apple Silicon &amp; Intel</div>
            </div>

            <div>
              <button 
                disabled
                className="inline-flex w-full h-9 items-center justify-center rounded-md bg-zinc-800 px-4 text-xs font-semibold text-zinc-500 cursor-not-allowed transition-all duration-150"
              >
                Coming Soon
              </button>
              <p className="text-[9px] text-[var(--text-tertiary)] mt-3 font-mono">Planned Release</p>
            </div>
          </div>

          {/* Linux OS (Coming Soon) */}
          <div
            className="flex flex-col justify-between rounded-lg border bg-[rgba(10,10,12,0.3)] p-6 text-center border-[var(--border-subtle)] opacity-70 relative overflow-hidden"
          >
            <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[8.5px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
              Coming Soon
            </span>
            <div>
              <Terminal className="h-8 w-8 mx-auto mb-5 text-zinc-500" />
              <h4 className="text-sm font-bold text-zinc-400 mb-1">Linux OS</h4>
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">Planned · x64 AppImage</div>
            </div>

            <div>
              <button 
                disabled
                className="inline-flex w-full h-9 items-center justify-center rounded-md bg-zinc-800 px-4 text-xs font-semibold text-zinc-500 cursor-not-allowed transition-all duration-150"
              >
                Coming Soon
              </button>
              <p className="text-[9px] text-[var(--text-tertiary)] mt-3 font-mono">Planned Release</p>
            </div>
          </div>

        </div>

        {/* Checksum Verification Walkthrough tab panel */}
        <div className="max-w-4xl mx-auto rounded-lg border border-[var(--border-subtle)] bg-[rgba(10,10,12,0.55)] p-5 text-left font-mono">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3.5 mb-4">
            <span className="text-[9px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Clipboard className="h-3.5 w-3.5 text-[var(--primary)]" /> Verify Installer Integrity
            </span>
            <div className="flex gap-2">
              <button 
                onClick={() => setActiveVerifyTab("win")}
                className={`px-2 py-0.5 rounded text-[8.5px] font-bold transition-all cursor-pointer ${
                  activeVerifyTab === "win" ? "bg-primary/10 text-primary border border-primary/20" : "text-[var(--text-secondary)]"
                }`}
              >
                Windows
              </button>
              <button 
                onClick={() => setActiveVerifyTab("mac")}
                className={`px-2 py-0.5 rounded text-[8.5px] font-bold transition-all cursor-pointer ${
                  activeVerifyTab === "mac" ? "bg-primary/10 text-primary border border-primary/20" : "text-[var(--text-secondary)]"
                }`}
              >
                macOS
              </button>
              <button 
                onClick={() => setActiveVerifyTab("linux")}
                className={`px-2 py-0.5 rounded text-[8.5px] font-bold transition-all cursor-pointer ${
                  activeVerifyTab === "linux" ? "bg-primary/10 text-primary border border-primary/20" : "text-[var(--text-secondary)]"
                }`}
              >
                Linux
              </button>
            </div>
          </div>

          <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed space-y-3">
            <div>
              <div className="text-[8px] text-[var(--text-tertiary)] uppercase mb-1">Verify Command</div>
              <div className="bg-[var(--background)] border border-[var(--border-subtle)] rounded p-2.5 flex items-center justify-between font-mono text-[9px] text-white">
                <span className="truncate select-text">{checksumData[activeVerifyTab].cmd}</span>
                <button 
                  onClick={() => copyToClipboard(checksumData[activeVerifyTab].cmd)}
                  className="p-1 rounded hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer shrink-0 ml-2"
                >
                  {copiedText ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Clipboard className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
                </button>
              </div>
            </div>

            <div>
              <div className="text-[8px] text-[var(--text-tertiary)] uppercase mb-1">Expected SHA256 Signature</div>
              <div className="bg-[var(--background)] border border-[var(--border-subtle)] rounded p-2.5 font-mono text-[8.5px] text-[var(--text-secondary)] select-text break-all">
                {checksumData[activeVerifyTab].hash}
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}
