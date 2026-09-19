"use client"

import React from "react"
import { motion } from "motion/react"
import { Cpu, Terminal, BookOpen, Layers } from "lucide-react"

export default function ApiDocsPage() {
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
            SDK Reference
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            API &amp; Integration Docs
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Integrate HUNTARA database tables with external scripting tasks or export custom CSV mappings locally.
          </motion.p>
        </div>

        {/* Integration Code Block */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Direct SQLite Queries (Node.js)</h2>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Because HUNTARA saves CRM pipelines in simple SQLite databases, you can connect directly to your local file and run custom SQL scripts.
          </p>

          <div className="bg-[var(--background)] border border-[var(--border-subtle)] p-4 rounded font-mono text-xs text-[var(--muted-foreground)] leading-relaxed select-all">
            import Database from 'better-sqlite3';<br />
            const db = new Database('~/.config/huntara/workspace.db');<br /><br />
            // Fetch hot leads with verified emails<br />
            const hotLeads = db.prepare(<br />
            &nbsp;&nbsp;&quot;SELECT name, domain, emails FROM leads WHERE score &gt;= 75&quot;<br />
            ).all();<br /><br />
            console.log(hotLeads);
          </div>
        </motion.div>

        {/* Schema block */}
        <motion.div variants={childVariants} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-3">
            <BookOpen className="h-4.5 w-4.5 text-[var(--primary)]" />
            <h3 className="text-xs font-semibold text-[var(--foreground)] font-mono">leads Table Schema</h3>
            <ul className="text-xs text-[var(--text-secondary)] space-y-1.5 list-disc list-inside leading-relaxed">
              <li>`id` (TEXT, Primary Key)</li>
              <li>`name` (TEXT, Company name)</li>
              <li>`domain` (TEXT, Company domain)</li>
              <li>`score` (INTEGER, Fit formula outcome)</li>
              <li>`emails` (TEXT, JSON array of contacts)</li>
            </ul>
          </div>

          <div className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-3">
            <Layers className="h-4.5 w-4.5 text-[var(--success)]" />
            <h3 className="text-xs font-semibold text-[var(--foreground)] font-mono">campaigns Table Schema</h3>
            <ul className="text-xs text-[var(--text-secondary)] space-y-1.5 list-disc list-inside leading-relaxed">
              <li>`id` (TEXT, Primary Key)</li>
              <li>`sender_id` (TEXT, SMTP relayer reference)</li>
              <li>`status` (TEXT, active/paused/completed)</li>
              <li>`schedule` (TEXT, Cron-like execution timing)</li>
            </ul>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
