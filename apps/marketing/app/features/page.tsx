"use client"

import React from "react"
import { motion } from "motion/react"
import { Search, Globe, Users, Table, Mail, Database, ShieldAlert, Cpu, Activity, ShieldCheck } from "lucide-react"

export default function FeaturesPage() {
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

  const featuresList = [
    {
      title: "Discovery Engine",
      icon: Search,
      description: "Direct scraping of Google Maps, local sector listings, and yellow-pages directories without limits. Gathers raw domains instantly.",
      color: "text-[var(--primary)]"
    },
    {
      title: "DNS & WHOIS Research",
      icon: Globe,
      description: "Queries raw domain registries, MX configurations, and website headers locally to parse site software stack details.",
      color: "text-[#5B8DEF]"
    },
    {
      title: "Contact Enrichment",
      icon: Users,
      description: "Scrapes domain landing sites, directories, and social handles locally using asynchronous client workers to verify emails.",
      color: "text-[var(--success)]"
    },
    {
      title: "LinkedIn Voyager API",
      icon: ShieldAlert,
      description: "Direct executive contacts extraction matching targets with company personnel leveraging native session cookies.",
      color: "text-[var(--primary)]"
    },
    {
      title: "Local CRM Workspace",
      icon: Table,
      description: "A fast, SQLite-backed grid for managing lead accounts, tracking notes, logging activity, and monitoring outreach pipelines.",
      color: "text-[var(--foreground)]"
    },
    {
      title: "Direct SMTP campaigns",
      icon: Mail,
      description: "Connects your local SMTP credentials directly to your target addresses. Handshakes TLS certificates on client side.",
      color: "text-[var(--primary)]"
    },
    {
      title: "WAL Database Syncing",
      icon: Database,
      description: "Leverages SQLite WAL modes to run heavy background scrapers in parallel without locking the user interface.",
      color: "text-[var(--text-secondary)]"
    },
    {
      title: "Sandboxed Worker Host",
      icon: Cpu,
      description: "Runs intensive Playwright scraping operations inside multi-process worker nodes without locking React's UI thread.",
      color: "text-[#5B8DEF]"
    },
    {
      title: "Diagnostics Cockpit",
      icon: Activity,
      description: "Monitors scheduler heartbeat logs, system resource averages, startup latency metrics, and circular log caches.",
      color: "text-[var(--success)]"
    }
  ]

  const comparisonRows = [
    { metric: "Hosting & Control", local: "100% Local (Your Hardware)", saas: "Cloud Server (Vendor Lock)" },
    { metric: "Outreach Limits", local: "None (Set by your mailboxes)", saas: "Usage packages / seat throttles" },
    { metric: "Lead Data Privacy", local: "Encrypted SQLite on your disk", saas: "Uploaded to third-party datastores" },
    { metric: "Scraper Overhead", local: "Runs on your Chromium worker thread", saas: "High pricing markups for hosting" },
    { metric: "Monthly Cost", local: "Free ($0 Open Beta)", saas: "$90 to $350 per seat / month" }
  ]

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-5xl mx-auto space-y-16"
      >
        {/* Header Block */}
        <div className="space-y-4 max-w-2xl">
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
            Platform Capabilities
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Features
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            obsessively engineered to give you direct control of your cold sales pipelines, running entirely on your machine.
          </motion.p>
        </div>

        {/* Feature Grid */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuresList.map((feat) => {
            const IconComp = feat.icon
            return (
              <div 
                key={feat.title} 
                className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4 hover:border-[var(--border-strong)] transition-all duration-200"
              >
                <div className={`p-2 rounded bg-[var(--background)] border border-[var(--border)] inline-block ${feat.color}`}>
                  <IconComp className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">{feat.title}</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{feat.description}</p>
                </div>
              </div>
            )
          })}
        </motion.div>

        {/* Extended Comparison Section */}
        <motion.div variants={childVariants} className="space-y-6 pt-6 text-left">
          <div className="space-y-2 max-w-xl">
            <h2 className="text-xl font-bold text-white font-mono">LeadForge OS vs. Cloud Outbound Platforms</h2>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Understand the core architectural advantages of running Outbound pipelines locally instead of renting SaaS seats.
            </p>
          </div>

          <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]">
            <table className="w-full border-collapse text-xs text-left">
              <thead>
                <tr className="bg-[var(--muted)] text-[10px] uppercase font-mono text-[var(--text-tertiary)] border-b border-[var(--border)] select-none">
                  <th className="px-4 py-2 font-normal">Architecture Capability</th>
                  <th className="px-4 py-2 font-semibold text-[var(--primary)]">LeadForge OS</th>
                  <th className="px-4 py-2 font-normal">Traditional Outbound SaaS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-secondary)]">
                {comparisonRows.map((row) => (
                  <tr key={row.metric} className="hover:bg-[rgba(255,255,255,0.01)] transition-colors">
                    <td className="px-4 py-3.5 font-medium text-[var(--foreground)]">{row.metric}</td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-white font-semibold">{row.local}</td>
                    <td className="px-4 py-3.5">{row.saas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Local Security block */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-xl bg-[var(--card)] p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
              <ShieldAlert className="h-4.5 w-4.5 text-[var(--primary)]" />
              100% Privacy Compliance
            </h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-xl leading-relaxed">
              We never upload your database logs, lead columns, or proxy keys to LeadForge. The data belongs entirely to you, sitting safely in local directories.
            </p>
          </div>
          <a 
            href="/security" 
            className="px-4 h-9 rounded bg-[var(--background)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)] transition-all flex items-center justify-center shrink-0 cursor-pointer"
          >
            Review Security Protocols
          </a>
        </motion.div>

      </motion.div>
    </div>
  )
}
