"use client"

import React from "react"
import { motion } from "motion/react"
import { Image, FileText, Download, Briefcase, FileCheck, MessageSquare } from "lucide-react"

export default function PressPage() {
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

  const factSheet = [
    { label: "Official Name", val: "HUNTARA" },
    { label: "Initial Release", val: "August 1, 2026 (v1.0.0-beta.1)" },
    { label: "Platform Target", val: "Windows 10 / 11 (x64 desktop environment)" },
    { label: "Core Architecture", val: "Local-first SQLite with WAL write streams" },
    { label: "License Model", val: "MIT Open Source License (Permissive)" }
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
            Press Kit
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Press Kit
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Media resources and boilerplate text for publications writing about HUNTARA, data sovereignty, and secure local-first architectures.
          </motion.p>
        </div>

        {/* Media Assets */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Logo package */}
          <div className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--primary)]">
                <Image className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Brand Logo Package</h2>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                Contains PNG extracts and logo suite formats of the HUNTARA logo (horizontal, stacked, icon marks) for media prints.
              </p>
            </div>
            <a 
              href="/brand" 
              className="inline-flex h-9 items-center justify-center rounded border border-[var(--border)] bg-[var(--background)] px-4 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)] transition-all cursor-pointer"
            >
              Get Logo Assets
            </a>
          </div>

          {/* Boilerplate text */}
          <div className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--primary)]">
                <FileText className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Product Boilerplate</h2>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                Summary details of the product architecture, developer guidelines, and company vision boilerplate.
              </p>
            </div>
            <div className="bg-[var(--background)] border border-[var(--border-subtle)] p-3.5 rounded text-[10px] text-[var(--text-secondary)] leading-relaxed font-mono">
              &ldquo;HUNTARA helps businesses find and understand their next customers. Find the companies worth selling to.&rdquo;
            </div>
          </div>

        </motion.div>

        {/* Extended Section 1: Fact Sheet */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-[var(--border-subtle)] pt-12">
          
          {/* List of Facts */}
          <div className="md:col-span-2 space-y-4 text-left">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <FileCheck className="h-4.5 w-4.5 text-[var(--primary)]" /> Fact Sheet
            </h2>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
              <table className="w-full border-collapse text-xs text-left">
                <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-secondary)]">
                  {factSheet.map((fact) => (
                    <tr key={fact.label}>
                      <td className="px-4 py-2.5 font-mono text-[10px] font-semibold text-[var(--foreground)] bg-[var(--background)] w-[160px]">{fact.label}</td>
                      <td className="px-4 py-2.5">{fact.val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Press Contact */}
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-3.5 flex flex-col justify-between">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-[var(--primary)]" /> Press Inquiries
              </h3>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                For interview requests with the maintainers or questions about outbound security models, please open an issue in our repository.
              </p>
            </div>
            <a 
              href="https://github.com/kjxcodez/leadforge-os/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded bg-[var(--primary)] text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all cursor-pointer"
            >
              Open GitHub Issue
            </a>
          </div>

        </motion.div>

      </motion.div>
    </div>
  )
}
