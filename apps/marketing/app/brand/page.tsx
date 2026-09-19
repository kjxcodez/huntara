"use client"

import React from "react"
import { motion } from "motion/react"
import { Download } from "lucide-react"

export default function BrandPage() {
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
        <div className="space-y-4 max-w-2xl">
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
            Identity guidelines
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            Brand Guidelines
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Official assets, typography, and color parameters defining the HUNTARA visual identity.
          </motion.p>
        </div>

        {/* Primary Logotypes Block */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Primary Logotypes &amp; Marks</h2>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">Official Vectors &amp; Extracts</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 select-none">
            {/* Horizontal Logo */}
            <div className="flex flex-col items-center justify-between p-6 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg min-h-[140px]">
              <div className="flex-1 flex items-center justify-center py-4">
                <img src="/huntara-logo-horizontal.png" className="h-8 max-w-[180px] object-contain" alt="HUNTARA Horizontal Logo" />
              </div>
              <div className="text-center w-full pt-3 border-t border-[var(--border-subtle)]">
                <div className="text-[11px] font-semibold text-[var(--foreground)]">Horizontal Wordmark</div>
                <div className="text-[9px] font-mono text-[var(--text-tertiary)] mt-0.5">huntara-logo-horizontal.png</div>
              </div>
            </div>

            {/* Stacked Logo */}
            <div className="flex flex-col items-center justify-between p-6 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg min-h-[140px]">
              <div className="flex-1 flex items-center justify-center py-2">
                <img src="/huntara-logo-stacked.png" className="h-16 max-w-[120px] object-contain" alt="HUNTARA Stacked Logo" />
              </div>
              <div className="text-center w-full pt-3 border-t border-[var(--border-subtle)]">
                <div className="text-[11px] font-semibold text-[var(--foreground)]">Stacked Logotype</div>
                <div className="text-[9px] font-mono text-[var(--text-tertiary)] mt-0.5">huntara-logo-stacked.png</div>
              </div>
            </div>

            {/* Icon Mark */}
            <div className="flex flex-col items-center justify-between p-6 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg min-h-[140px]">
              <div className="flex-1 flex items-center justify-center py-4">
                <img src="/huntara-mark.png" className="h-12 w-12 object-contain" alt="HUNTARA Mark" />
              </div>
              <div className="text-center w-full pt-3 border-t border-[var(--border-subtle)]">
                <div className="text-[11px] font-semibold text-[var(--foreground)]">Brand Icon Mark</div>
                <div className="text-[9px] font-mono text-[var(--text-tertiary)] mt-0.5">huntara-mark.png</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Logo Marks Block */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">App Icon Variants</h2>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">Desktop &amp; OS Themes</span>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 select-none">
            {/* Default Icon */}
            <div className="flex flex-col items-center justify-center p-5 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg space-y-3">
              <img src="/app-icon.png" className="h-10 w-10 object-contain" alt="HUNTARA Default Logo Mark" />
              <div className="text-center">
                <div className="text-[10px] font-semibold text-[var(--foreground)]">Default</div>
                <div className="text-[8px] font-mono text-[var(--text-tertiary)] mt-0.5">app-icon.png</div>
              </div>
            </div>

            {/* Dark Mode Icon */}
            <div className="flex flex-col items-center justify-center p-5 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg space-y-3">
              <img src="/app-icon-dark.png" className="h-10 w-10 object-contain" alt="HUNTARA Dark Mode Logo Mark" />
              <div className="text-center">
                <div className="text-[10px] font-semibold text-[var(--foreground)]">Dark Mode</div>
                <div className="text-[8px] font-mono text-[var(--text-tertiary)] mt-0.5">app-icon-dark.png</div>
              </div>
            </div>

            {/* Light Mode Icon */}
            <div className="flex flex-col items-center justify-center p-5 bg-white border border-[var(--border-subtle)] rounded-lg space-y-3">
              <img src="/app-icon-light.png" className="h-10 w-10 object-contain" alt="HUNTARA Light Mode Logo Mark" />
              <div className="text-center">
                <div className="text-[10px] font-semibold text-slate-800">Light Mode</div>
                <div className="text-[8px] font-mono text-slate-400 mt-0.5">app-icon-light.png</div>
              </div>
            </div>

            {/* Monochrome Icon */}
            <div className="flex flex-col items-center justify-center p-5 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg space-y-3">
              <img src="/app-icon-monochrome.png" className="h-10 w-10 object-contain opacity-70" alt="HUNTARA Monochrome Logo Mark" />
              <div className="text-center">
                <div className="text-[10px] font-semibold text-[var(--foreground)]">Monochrome</div>
                <div className="text-[8px] font-mono text-[var(--text-tertiary)] mt-0.5">app-icon-monochrome.png</div>
              </div>
            </div>

            {/* Alternative Icon */}
            <div className="flex flex-col items-center justify-center p-5 bg-[var(--background)] border border-[var(--border-subtle)] rounded-lg space-y-3 col-span-2 md:col-span-1">
              <img src="/app-icon-alt.png" className="h-10 w-10 object-contain" alt="HUNTARA Alternative Logo Mark" />
              <div className="text-center">
                <div className="text-[10px] font-semibold text-[var(--foreground)]">Alternative</div>
                <div className="text-[8px] font-mono text-[var(--text-tertiary)] mt-0.5">app-icon-alt.png</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Color Palette Specifications */}
        <motion.div variants={childVariants} className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Primary Palette Colors</h2>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">Calibrated HEX &amp; RGB</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            
            {/* HUNTARA Orange (Source Exact) */}
            <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
              <div className="h-16 bg-[#FA7125]" />
              <div className="p-3 text-left">
                <div className="font-semibold text-xs text-[var(--foreground)]">HUNTARA Orange</div>
                <div className="font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">#FA7125</div>
                <div className="font-mono text-[8px] text-[var(--text-tertiary)] mt-0.5">rgb(250, 113, 37)</div>
              </div>
            </div>

            {/* HUNTARA Accessible Orange */}
            <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
              <div className="h-16 bg-[#E05E18]" />
              <div className="p-3 text-left">
                <div className="font-semibold text-xs text-[var(--foreground)]">Light Mode Accent</div>
                <div className="font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">#E05E18</div>
                <div className="font-mono text-[8px] text-[var(--text-tertiary)] mt-0.5">WCAG AA Contrast</div>
              </div>
            </div>

            {/* Base Background */}
            <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
              <div className="h-16 bg-[#0A0A0B]" />
              <div className="p-3 text-left">
                <div className="font-semibold text-xs text-[var(--foreground)]">Base Dark</div>
                <div className="font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">#0A0A0B</div>
                <div className="font-mono text-[8px] text-[var(--text-tertiary)] mt-0.5">App Canvas</div>
              </div>
            </div>

            {/* Card Surface */}
            <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
              <div className="h-16 bg-[#131316]" />
              <div className="p-3 text-left">
                <div className="font-semibold text-xs text-[var(--foreground)]">Surface Card</div>
                <div className="font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">#131316</div>
                <div className="font-mono text-[8px] text-[var(--text-tertiary)] mt-0.5">Card Background</div>
              </div>
            </div>

            {/* Primary Text */}
            <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
              <div className="h-16 bg-[#F4F4F5]" />
              <div className="p-3 text-left">
                <div className="font-semibold text-xs text-[var(--foreground)]">Foreground Text</div>
                <div className="font-mono text-[9px] text-[var(--text-tertiary)] mt-0.5">#F4F4F5</div>
                <div className="font-mono text-[8px] text-[var(--text-tertiary)] mt-0.5">Primary Font</div>
              </div>
            </div>

          </div>
        </motion.div>

        {/* Brand Voice & Positioning */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] space-y-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Tagline &amp; Positioning</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <div className="p-4 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Primary Tagline</div>
              <div className="text-sm font-semibold text-white">&ldquo;Find the companies worth selling to.&rdquo;</div>
            </div>
            <div className="p-4 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Core Positioning</div>
              <div className="text-sm text-[var(--text-secondary)]">&ldquo;HUNTARA helps businesses find and understand their next customers.&rdquo;</div>
            </div>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
