"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { Monitor, Apple, Terminal, ArrowDown, ArrowDownToLine, ArrowRight } from "lucide-react"
import { getLatestRelease, PlatformId } from "../lib/generated-releases"
import { SparklesCore } from "./ui/sparkles"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"

function PlatformIcon({ id, className }: { id: PlatformId; className?: string }) {
  if (id === "windows") return <Monitor className={className || "h-8 w-8"} />
  if (id === "macos") return <Apple className={className || "h-8 w-8"} />
  return <Terminal className={className || "h-8 w-8"} />
}

export function Downloads() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformId>("windows")

  // Platform detection on client mount
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

        {/* Download Cards Grid — Renders ONLY available platforms from latest release */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8 select-none">
          {latestRelease.platforms.map((plat) => {
            const isDetected = detectedPlatform === plat.id
            return (
              <div
                key={plat.id}
                className={`flex flex-col justify-between rounded-xl border bg-[rgba(10,10,12,0.5)] p-6 text-center transition-all duration-200 relative overflow-hidden ${
                  isDetected
                    ? "border-primary/50 shadow-[0_0_20px_rgba(250,113,37,0.06)] scale-[1.01]"
                    : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                }`}
              >
                {isDetected && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-[8.5px] font-mono text-primary font-bold uppercase tracking-wider">
                    Recommended
                  </span>
                )}

                <div>
                  <PlatformIcon id={plat.id} className="h-8 w-8 mx-auto mb-5 text-white" />
                  <h4 className="text-sm font-bold text-white mb-1">
                    {plat.label}
                  </h4>
                  <div className="font-mono text-[10px] text-[var(--text-tertiary)] mb-6">
                    {latestRelease.version} · {plat.artifacts[0]?.architectureLabel}
                  </div>
                </div>

                <div className="space-y-3">
                  {plat.artifacts.map((art) => (
                    <a
                      key={art.id}
                      href={art.downloadUrl}
                      className="inline-flex w-full h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all duration-150"
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      Download for {plat.label} ({art.architectureLabel})
                    </a>
                  ))}

                  <div className="pt-2 border-t border-[var(--border-subtle)]">
                    <Link
                      href={`/releases/${latestRelease.version}/${plat.id}`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)] hover:text-primary transition-colors"
                    >
                      Checksum &amp; release notes <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer Link to All Releases */}
        <div className="text-left pt-4">
          <Link
            href="/releases"
            className="inline-flex items-center gap-2 text-xs font-mono text-[var(--text-tertiary)] hover:text-[var(--foreground)] transition-colors"
          >
            Looking for previous versions? View all releases <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </section>
  )
}
