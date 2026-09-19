"use client"

import React from "react"
import { motion } from "motion/react"
import { Users, Heart, Code2, Cpu, GitPullRequest } from "lucide-react"
import { GENERATED_CONTRIBUTORS } from "../../lib/generated-contributors"

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

export default function ContributorsPage() {
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

  const contributors = GENERATED_CONTRIBUTORS.map(c => ({
    name: c.login,
    role: c.login === "kjxcodez" ? "Creator & Lead Architect" : "Contributor",
    avatar: c.avatar_url,
    commits: c.contributions,
    github: c.html_url
  }))

  const tracks = [
    { title: "Automation Engine", desc: "Build Playwright / Cheerio target scripts to fetch contacts locally.", icon: Cpu },
    { title: "IPC Core Optimization", desc: "Reduce messaging latency between Hono, Electron, and React.", icon: Code2 },
    { title: "UI Components", desc: "Design elegant workspace tables, filters, and pipeline visualization charts.", icon: GitPullRequest }
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
            Active Maintainers
          </motion.div>
          <motion.h1 variants={childVariants} className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Contributors
          </motion.h1>
          <motion.p variants={childVariants} className="text-base text-[var(--text-secondary)] leading-relaxed">
            Meet the engineers, architects, and technical contributors driving the development of the HUNTARA local-first outbound environment.
          </motion.p>
        </div>

        {/* Contributors grid */}
        <motion.div variants={childVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {contributors.map((contrib) => (
            <a
              key={contrib.name}
              href={contrib.github}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-[var(--border)] rounded-lg p-5 bg-[var(--card)] flex flex-col justify-between hover:border-[var(--border-strong)] hover:shadow-md transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded overflow-hidden bg-[var(--primary)] select-none border border-[var(--border-subtle)]">
                  <img src={contrib.avatar} alt={contrib.name} className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[var(--foreground)]">{contrib.name}</div>
                  <div className="truncate text-[10px] text-[var(--text-tertiary)]">{contrib.role}</div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3.5 mt-4 text-[9px] font-mono">
                <span className="text-[var(--primary)]">{contrib.commits} commits</span>
                <span className="text-[var(--text-tertiary)] hover:text-white flex items-center gap-1">
                  <GithubIcon className="h-3 w-3" /> profile
                </span>
              </div>
            </a>
          ))}
        </motion.div>

        {/* Extended Section: Development Tracks */}
        <motion.div variants={childVariants} className="space-y-6 pt-6">
          <h2 className="text-xl font-semibold text-[var(--foreground)]">Contribution Tracks</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tracks.map((track) => {
              const Icon = track.icon
              return (
                <div key={track.title} className="border border-[var(--border-subtle)] rounded-lg p-5 bg-[var(--card)] space-y-3">
                  <div className="p-2 rounded bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-[var(--primary)]">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">{track.title}</h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{track.desc}</p>
                </div>
              )
            })}
          </div>
        </motion.div>

        {/* Call to action */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)] text-center space-y-4 max-w-xl mx-auto">
          <Heart className="h-8 w-8 text-[var(--primary)] mx-auto animate-pulse" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Want to contribute?</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-sans">
              Find issues labeled `good first issue` or `help wanted` in our repository. Read our contribution guidelines to align with SQLite WAL architecture.
            </p>
          </div>
          <a
            href="https://github.com/kjxcodez/huntara"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center rounded bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all cursor-pointer"
          >
            Explore kjxcodez Repository
          </a>
        </motion.div>

      </motion.div>
    </div>
  )
}
