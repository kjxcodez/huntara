"use client"

import React, { useRef } from "react"
import { motion, useScroll, useTransform } from "motion/react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
import { Map, Milestone, Check, Clock } from "lucide-react"

export function Roadmap() {
  const timelineRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()

  // Scroll linked timeline height animation
  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ["start 75%", "end 75%"],
  })

  // Connect scaleY to scroll progress
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1])

  const roadmapItems = [
    {
      title: "Asynchronous worker schedules",
      status: "Shipped",
      statusType: "shipped",
      desc: "Isolated background subprocess manager handles exponential retries and rate limit backoffs.",
    },
    {
      title: "Local SQLite database sync engine",
      status: "Shipped",
      statusType: "shipped",
      desc: "Bi-directional mutation queues with Last-Write-Wins (LWW) conflict mapping.",
    },
    {
      title: "Local vector DB support (sqlite-vec)",
      status: "In Progress",
      statusType: "progress",
      desc: "Embedding vector search engine for qualified lead semantic proximity weighting.",
    },
    {
      title: "Decentralized SMTP relay templates",
      status: "In Progress",
      statusType: "progress",
      desc: "Wired-in SMTP check-pointer profiles allowing custom sending pools.",
    },
    {
      title: "Multi-platform packages (Mac & Linux)",
      status: "In Progress",
      statusType: "progress",
      desc: "Native Mac (.dmg) and Linux (.AppImage) signed bundle targets in active QA.",
    }
  ]

  const itemVariants = {
    hidden: { opacity: 0, x: -8 },
    visible: { 
      opacity: 1, 
      x: 0,
      transition: { duration: 0.4, ease: "easeOut" as const }
    }
  } as const

  return (
    <section id="roadmap" className="py-24 border-t border-[var(--border-subtle)] bg-[#070708] relative overflow-hidden lg:px-32 md:px-20 px-4">
      <div className="container mx-auto px-6">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-16 text-left">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
            <Map className="h-3.5 w-3.5 text-[var(--primary)]" />
            Product Milestone Logs
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4 md:text-4xl">
            Where HUNTARA stands
          </h2>
          <p className="text-[var(--text-secondary)] leading-relaxed text-xs sm:text-sm">
            Live internal pipeline status direct from our source repository branches.
          </p>
        </div>

        {/* Timeline Layout */}
        <div ref={timelineRef} className="relative max-w-2xl pl-1 select-none text-left">
          {/* Connector Line Background */}
          <div className="absolute left-[5px] top-1.5 bottom-1.5 w-[1px] bg-[var(--border-subtle)]" />

          {/* Animated Scroll Connected Connector Line */}
          {!prefersReducedMotion && (
            <motion.div 
              style={{ scaleY, transformOrigin: "top" }}
              className="absolute left-[9px] top-1.5 bottom-1.5 w-[1px] bg-[var(--primary)]"
            />
          )}

          {/* Timeline Items */}
          <div className="flex flex-col">
            {roadmapItems.map((item, idx) => {
              const isShipped = item.statusType === "shipped"

              return (
                <motion.div
                  key={idx}
                  variants={itemVariants}
                  initial={prefersReducedMotion ? "visible" : "hidden"}
                  whileInView="visible"
                  viewport={{ once: true, margin: "-100px" }}
                  className="relative pl-8 pb-10 last:pb-0 font-mono"
                >
                  {/* Timeline Dot Indicator */}
                  <span className={`absolute left-0 top-[3px] z-10 h-3 w-3 rounded-full border-2 bg-[#070708] transition-all duration-300 flex items-center justify-center ${
                    isShipped 
                      ? "border-green-400 bg-green-500/10 text-green-400" 
                      : "border-[var(--primary)] bg-primary/10 text-primary"
                  }`}>
                    {isShipped ? <Check className="h-1.5 w-1.5" /> : <Clock className="h-1.5 w-1.5" />}
                  </span>

                  {/* Item Content Card */}
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-1.5">
                      <h4 className="text-xs font-bold text-white leading-snug">
                        {item.title}
                      </h4>
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[8px] uppercase tracking-wider font-semibold ${
                        isShipped 
                          ? "bg-zinc-800 text-zinc-400 border border-zinc-700" 
                          : "bg-primary/10 text-primary border border-primary/20"
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] max-w-xl font-sans">
                      {item.desc}
                    </p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

      </div>
    </section>
  )
}
