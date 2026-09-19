"use client"

import React, { useState, useEffect } from "react"
import { motion } from "motion/react"
import { Activity, ShieldCheck, Heart, Server } from "lucide-react"

export default function StatusPage() {
  const [pulseWidth, setPulseWidth] = useState(100)

  useEffect(() => {
    const timer = setInterval(() => {
      setPulseWidth((w) => (w === 100 ? 95 : 100))
    }, 1500)
    return () => clearInterval(timer)
  }, [])

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

  const systems = [
    { name: "Marketing Website CDN", status: "Operational", desc: "Serves the main product landing pages and visual UI walkthrough components." },
    { name: "Documentation Site", status: "Operational", desc: "Hosts interactive MDX guides, API references, and ADR documentation logs." },
    { name: "GitHub Releases Endpoint", status: "Operational", desc: "Distributes cryptographic package releases and signed desktop binaries." }
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
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border border-[rgba(63,178,127,0.2)] text-[10px] uppercase tracking-wider font-mono">
            System Operational
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Service Status
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Real-time status updates of HUNTARA website delivery networks, static assets documentation portals, and release endpoints.
          </motion.p>
        </div>

        {/* CDN Pulse Monitor */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-[var(--primary)]" />
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Asset Delivery network (CDN) Latency</h2>
            </div>
            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">Ping: 12ms</span>
          </div>
          
          <div className="h-10 bg-[var(--background)] border border-[var(--border-subtle)] rounded flex items-center px-4 overflow-hidden relative">
            <motion.div 
              animate={{ width: `${pulseWidth}%` }}
              className="h-[2px] bg-gradient-to-r from-[var(--primary)] to-[var(--success)] rounded"
            />
          </div>
        </motion.div>

        {/* Systems List */}
        <motion.div variants={childVariants} className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Individual Services</h2>
          <div className="space-y-3">
            {systems.map((sys) => (
              <div key={sys.name} className="flex items-start justify-between border border-[var(--border)] rounded-lg p-4 bg-[var(--card)]">
                <div className="space-y-1 text-left">
                  <h3 className="text-xs font-semibold text-[var(--foreground)]">{sys.name}</h3>
                  <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{sys.desc}</p>
                </div>
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border-[rgba(63,178,127,0.2)]">
                  {sys.status}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
