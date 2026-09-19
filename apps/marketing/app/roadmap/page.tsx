"use client"

import React, { useRef } from "react"
import { motion, useScroll, useTransform } from "motion/react"
import { CheckCircle2, Circle, HelpCircle } from "lucide-react"

export default function RoadmapPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start center", "end center"]
  })

  // Draw timeline down as user scrolls
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1])

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

  const milestones = [
    {
      quarter: "Completed (v1.0.0-beta.1)",
      status: "completed",
      title: "Local-First Core & Discovery",
      description: "Desktop environment with sandboxed worker host, local SQLite datastores, Playwright scraper, LinkedIn Voyager integrations, local CRM, and diagnostics telemetry.",
      items: [
        "Workspace-isolated SQLite with WAL mode writer pools",
        "Playwright Google Maps Scraper and Cheerio crawler",
        "LinkedIn Voyager API profile integrations",
        "SRE telemetry metrics dashboard and local rotating log buffer"
      ]
    },
    {
      quarter: "Current (In Progress)",
      status: "in-progress",
      title: "Hardening & Integration Guides",
      description: "Refactoring developer manuals, documenting ADR design logs, securing imports, and key fallback storage handlers.",
      items: [
        "SafeStorage fallback optimization on Unix keyrings",
        "Preventing dependency-cruiser boundary cycles",
        "Comprehensive user documentation portal"
      ]
    },
    {
      quarter: "Planned (Upcoming)",
      status: "planned",
      title: "Cloud Backup & Multi-Platform Installer",
      description: "Expanding the system to run on macOS/Linux while introducing optional delta-based cloud syncing relayers.",
      items: [
        "Multi-platform installer builds (macOS dmg, Linux AppImage)",
        "Local RAG and vector embeddings via sqlite-vec",
        "Workspace synchronizer sync engine optimization",
        "Third-party email verification adapters"
      ]
    }
  ]

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
            Outreach Milestones
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            Development Roadmap
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Follow the active development checklist of HUNTARA. Everything is built open-source.
          </motion.p>
        </div>

        {/* Timeline Timeline */}
        <motion.div variants={childVariants} ref={containerRef} className="relative pl-8 md:pl-12 space-y-12">
          {/* Vertical Base Line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-[var(--border)]" />
          
          {/* Scroll Connected Active Line */}
          <motion.div 
            style={{ scaleY, transformOrigin: "top" }} 
            className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-[var(--primary)]" 
          />

          {milestones.map((milestone) => (
            <div key={milestone.quarter} className="relative space-y-4">
              
              {/* Timeline Indicator Node */}
              <div className="absolute -left-[30px] md:-left-[38px] top-0 bg-[var(--background)] p-1 rounded-full z-10 border border-[var(--border)]">
                {milestone.status === "completed" ? (
                  <CheckCircle2 className="h-4.5 w-4.5 text-[var(--success)]" />
                ) : milestone.status === "in-progress" ? (
                  <Circle className="h-4.5 w-4.5 text-[var(--primary)] animate-pulse" />
                ) : (
                  <Circle className="h-4.5 w-4.5 text-[var(--text-tertiary)]" />
                )}
              </div>

              {/* Card Block */}
              <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--primary)] font-semibold">
                    {milestone.quarter}
                  </span>
                  <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    milestone.status === "completed" 
                      ? "bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border-[rgba(63,178,127,0.2)]" 
                      : milestone.status === "in-progress" 
                        ? "bg-[rgba(217,164,65,0.12)] text-[#D9A441] border-[rgba(217,164,65,0.2)]" 
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] border-[var(--border-subtle)]"
                  }`}>
                    {milestone.status}
                  </span>
                </div>

                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-[var(--foreground)]">{milestone.title}</h2>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{milestone.description}</p>
                </div>

                <ul className="text-xs text-[var(--text-secondary)] space-y-1.5 list-disc list-inside border-t border-[var(--border-subtle)] pt-4 leading-relaxed">
                  {milestone.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

            </div>
          ))}
        </motion.div>

      </motion.div>
    </div>
  )
}
