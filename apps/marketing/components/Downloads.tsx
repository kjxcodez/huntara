"use client"

import React, { useEffect, useState } from "react"
import { motion } from "motion/react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
import { Monitor, Apple, Terminal, ArrowDown } from "lucide-react"
import { GENERATED_RELEASES } from "../lib/generated-releases"
import { SparklesCore } from "./ui/sparkles"

export function Downloads() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [detectedPlatform, setDetectedPlatform] = useState<"win" | "mac" | "linux">("win")

  // Platform detection logic on client mount
  useEffect(() => {
    if (typeof window === "undefined") return
    const platform = window.navigator.platform.toLowerCase()
    const userAgent = window.navigator.userAgent.toLowerCase()
    
    if (platform.includes("win") || userAgent.includes("windows")) {
      setDetectedPlatform("win")
    } else if (platform.includes("mac") || userAgent.includes("macintosh")) {
      setDetectedPlatform("mac")
    } else if (platform.includes("linux") || platform.includes("x11")) {
      setDetectedPlatform("linux")
    }
  }, [])

  // Find latest stable vs. latest pre-release
  const latestRelease = GENERATED_RELEASES.find(r => !r.prerelease) || GENERATED_RELEASES[0]
  const winAsset = latestRelease?.assets.find(a => a.platform === 'Windows' || a.name.endsWith('.exe'))
  const macAsset = latestRelease?.assets.find(a => a.platform === 'macOS' || a.name.endsWith('.dmg') || a.name.endsWith('.zip'))
  const linuxAsset = latestRelease?.assets.find(a => a.platform === 'Linux' || a.name.endsWith('.AppImage'))
  
  const winUrl = winAsset?.downloadUrl || "https://github.com/kjxcodez/leadforge-os/releases/latest"
  const macUrl = macAsset?.downloadUrl || ""
  const linuxUrl = linuxAsset?.downloadUrl || ""
  const winVersion = latestRelease?.version || "v1.2.0-beta"

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
            Official Desktop Builds
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4 md:text-4xl">
            Get HUNTARA
          </h2>
          <p className="text-[var(--text-secondary)] leading-relaxed text-xs sm:text-sm">
            Find the companies worth selling to. Download the local-first application for your operating system.
          </p>
        </div>

        {/* Download Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 select-none">
          
          {/* Windows */}
          <div
            className={`flex flex-col justify-between rounded-xl border bg-[rgba(10,10,12,0.5)] p-6 text-center transition-all duration-200 relative overflow-hidden ${
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
              <h4 className="text-sm font-bold text-white mb-1">Windows</h4>
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">{winVersion} · x64 Installer</div>
            </div>
            
            <div>
              <a 
                href={winUrl} 
                className="inline-flex w-full h-9 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all duration-150"
              >
                Download for Windows (.exe)
              </a>
              <p className="text-[9px] text-[var(--text-tertiary)] mt-3 font-mono">Installer</p>
            </div>
          </div>

          {/* macOS */}
          <div
            className={`flex flex-col justify-between rounded-xl border bg-[rgba(10,10,12,0.5)] p-6 text-center transition-all duration-200 relative overflow-hidden ${
              detectedPlatform === "mac" 
                ? "border-primary/50 shadow-[0_0_20px_rgba(250,113,37,0.06)] scale-[1.01]" 
                : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
            } ${!macAsset ? "opacity-75" : ""}`}
          >
            <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[8.5px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
              {macAsset ? "Available" : "Coming Soon"}
            </span>
            <div>
              <Apple className="h-8 w-8 mx-auto mb-5 text-zinc-300" />
              <h4 className="text-sm font-bold text-zinc-200 mb-1">macOS</h4>
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">Apple Silicon &amp; Intel</div>
            </div>

            <div>
              {macAsset ? (
                <a 
                  href={macUrl} 
                  className="inline-flex w-full h-9 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all duration-150"
                >
                  Download for macOS (.dmg)
                </a>
              ) : (
                <button 
                  disabled
                  className="inline-flex w-full h-9 items-center justify-center rounded-md bg-zinc-800 px-4 text-xs font-semibold text-zinc-500 cursor-not-allowed transition-all duration-150"
                >
                  Coming Soon
                </button>
              )}
              <p className="text-[9px] text-[var(--text-tertiary)] mt-3 font-mono">{macAsset ? "DMG Package" : "Release Planned"}</p>
            </div>
          </div>

          {/* Linux */}
          <div
            className={`flex flex-col justify-between rounded-xl border bg-[rgba(10,10,12,0.5)] p-6 text-center transition-all duration-200 relative overflow-hidden ${
              detectedPlatform === "linux" 
                ? "border-primary/50 shadow-[0_0_20px_rgba(250,113,37,0.06)] scale-[1.01]" 
                : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
            } ${!linuxAsset ? "opacity-75" : ""}`}
          >
            <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[8.5px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
              {linuxAsset ? "Available" : "Coming Soon"}
            </span>
            <div>
              <Terminal className="h-8 w-8 mx-auto mb-5 text-zinc-300" />
              <h4 className="text-sm font-bold text-zinc-200 mb-1">Linux</h4>
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">x64 AppImage</div>
            </div>

            <div>
              {linuxAsset ? (
                <a 
                  href={linuxUrl} 
                  className="inline-flex w-full h-9 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all duration-150"
                >
                  Download for Linux (.AppImage)
                </a>
              ) : (
                <button 
                  disabled
                  className="inline-flex w-full h-9 items-center justify-center rounded-md bg-zinc-800 px-4 text-xs font-semibold text-zinc-500 cursor-not-allowed transition-all duration-150"
                >
                  Coming Soon
                </button>
              )}
              <p className="text-[9px] text-[var(--text-tertiary)] mt-3 font-mono">{linuxAsset ? "AppImage" : "Release Planned"}</p>
            </div>
          </div>

        </div>

      </div>
    </section>
  )
}
