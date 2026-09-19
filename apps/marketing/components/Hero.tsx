"use client"

import React, { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from "motion/react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
import { ArrowRight, Monitor, Play, Check, ShieldAlert, Cpu, HardDrive, RefreshCw, Zap, Server, Database, Globe, Mail, Eye } from "lucide-react"

// Types of operations
type PipelineStep = "found" | "crawl" | "whois" | "contacts" | "verify" | "analyze" | "score" | "queue" | "crm"

// Theme Configurations
interface ThemeConfig {
  primary: string
  accent: string
  glowGradient: string
  textGradient: string
  badgeBg: string
  badgeText: string
  accentColor: string
}

const THEME_VARIANTS: Record<string, ThemeConfig> = {
  dark: {
    primary: "rgba(250, 113, 37, 1)",
    accent: "rgba(250, 113, 37, 0.2)",
    glowGradient: "from-[rgba(250,113,37,0.15)] to-[rgba(251,146,60,0.05)]",
    textGradient: "from-[var(--primary)] to-amber-500",
    badgeBg: "bg-primary/10 border-primary/20",
    badgeText: "text-primary",
    accentColor: "#FA7125"
  },
  blue: {
    primary: "rgba(59, 130, 246, 1)",
    accent: "rgba(59, 130, 246, 0.2)",
    glowGradient: "from-[rgba(59,130,246,0.15)] to-[rgba(147,197,253,0.05)]",
    textGradient: "from-blue-500 to-cyan-400",
    badgeBg: "bg-blue-500/10 border-blue-500/20",
    badgeText: "text-blue-400",
    accentColor: "#3B82F6"
  },
  orange: {
    primary: "rgba(245, 158, 11, 1)",
    accent: "rgba(245, 158, 11, 0.2)",
    glowGradient: "from-[rgba(245,158,11,0.15)] to-[rgba(253,230,138,0.05)]",
    textGradient: "from-amber-500 to-yellow-400",
    badgeBg: "bg-amber-500/10 border-amber-500/20",
    badgeText: "text-amber-400",
    accentColor: "#F59E0B"
  },
  purple: {
    primary: "rgba(168, 85, 247, 1)",
    accent: "rgba(168, 85, 247, 0.2)",
    glowGradient: "from-[rgba(168,85,247,0.15)] to-[rgba(233,213,255,0.05)]",
    textGradient: "from-purple-500 to-pink-500",
    badgeBg: "bg-purple-500/10 border-purple-500/20",
    badgeText: "text-purple-400",
    accentColor: "#A855F7"
  },
  minimal: {
    primary: "rgba(255, 255, 255, 0.9)",
    accent: "rgba(255, 255, 255, 0.1)",
    glowGradient: "from-[rgba(255,255,255,0.08)] to-[rgba(255,255,255,0.02)]",
    textGradient: "from-white to-gray-400",
    badgeBg: "bg-white/5 border-white/10",
    badgeText: "text-white",
    accentColor: "#FFFFFF"
  }
}

// Background SQL log simulation lines
const MOCK_BACKGROUND_SQL = [
  "SELECT * FROM leads WHERE status = 'HOT' ORDER BY score DESC LIMIT 10;",
  "INSERT INTO contacts (id, name, email, score) VALUES ('c_9a31', 'Alice Green', 'a.green@vortex.io', 94);",
  "PRAGMA journal_mode = WAL;",
  "UPDATE leads SET enriched = 1, sync_status = 'synced' WHERE id = 12903;",
  "CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (score DESC);",
  "BEGIN TRANSACTION;",
  "COMMIT;",
  "SELECT COUNT(*) FROM discovery_queue WHERE active = 1;",
  "INSERT INTO outreach_log (sequence_id, lead_id, sent_at) VALUES ('seq_b8', 4322, datetime('now'));"
]

export function Hero() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  // Cinematic Entrance Stages
  const [entranceStage, setEntranceStage] = useState(0)

  // Current active theme key & config
  const [themeKey, setThemeKey] = useState<string>("dark")
  const activeTheme = THEME_VARIANTS[themeKey]

  // Pipeline simulation data state
  const [leads, setLeads] = useState([
    { name: "Symphony Inc", domain: "symphony.co", score: 88, status: "CRM", email: "h.vance@symphony.co" },
    { name: "Aero Labs", domain: "aerolabs.io", score: 79, status: "AI Analysis", email: "info@aerolabs.io" },
    { name: "Starlight Corp", domain: "starlight.net", score: 62, status: "Verified", email: "contact@starlight.net" }
  ])
  const [currentPipelineStep, setCurrentPipelineStep] = useState<PipelineStep>("crm")
  const [pipelineText, setPipelineText] = useState("Operation idle...")
  const [liveLogs, setLiveLogs] = useState<string[]>([
    "SQLite system initialized.",
    "Discovery engine standing by."
  ])
  const [sqlQueries, setSqlQueries] = useState<string[]>([])

  // Dynamic Metrics Counters
  const [emailsVerifiedCount, setEmailsVerifiedCount] = useState(24532)
  const [confidenceScore, setConfidenceScore] = useState(98)
  const [syncDelay, setSyncDelay] = useState(2)

  // 3D Tilt Values
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const tiltX = useTransform(mouseY, [-400, 400], [8, -8])
  const tiltY = useTransform(mouseX, [-400, 400], [-8, 8])
  
  const tiltXSpring = useSpring(tiltX, { damping: 45, stiffness: 180 })
  const tiltYSpring = useSpring(tiltY, { damping: 45, stiffness: 180 })

  // Spotlight Coordinates
  const spotlightX = useSpring(mouseX, { damping: 55, stiffness: 220 })
  const spotlightY = useSpring(mouseY, { damping: 55, stiffness: 220 })

  // Background Sql stream coordinate y trackers
  const [bgSqlStream, setBgSqlStream] = useState<Array<{ id: number; text: string; x: number; y: number; speed: number }>>([])

  // Scroll camera parallax factor
  const [scrollProgress, setScrollProgress] = useState(0)

  // Cycle themes on clicking logo
  const cycleTheme = () => {
    const keys = Object.keys(THEME_VARIANTS)
    const nextIdx = (keys.indexOf(themeKey) + 1) % keys.length
    setThemeKey(keys[nextIdx])
  }

  // Monitor Window Scroll for scroll-driven hero camera
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY
      const maxScroll = 600
      setScrollProgress(Math.min(1, scrollY / maxScroll))
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Cinematic Entrance Sequence Timeline
  useEffect(() => {
    const timers = [
      setTimeout(() => setEntranceStage(1), 100),  // Fades background grid
      setTimeout(() => setEntranceStage(2), 300),  // Draw visual pipelines
      setTimeout(() => setEntranceStage(3), 600),  // Stagger reveal headings
      setTimeout(() => setEntranceStage(4), 1000), // Animate dashboard card
      setTimeout(() => setEntranceStage(5), 1400), // Start local log tickers
      setTimeout(() => setEntranceStage(6), 1800)  // Enable interactive physics
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // Dynamic mouse coordinates tracking
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (prefersReducedMotion) return
      const dx = e.clientX - window.innerWidth / 2
      const dy = e.clientY - window.innerHeight / 2
      mouseX.set(dx)
      mouseY.set(dy)
    }
    window.addEventListener("mousemove", handleGlobalMouseMove)
    return () => window.removeEventListener("mousemove", handleGlobalMouseMove)
  }, [mouseX, mouseY, prefersReducedMotion])

  // Central simulation loop representing a live operating system
  useEffect(() => {
    if (prefersReducedMotion) return

    const pipelineSequence: Array<{ step: PipelineStep; text: string }> = [
      { step: "found", text: "New target domain identified: 'vortex.io'" },
      { step: "crawl", text: "Crawling web interface for decision makers..." },
      { step: "whois", text: "Reading WHOIS registry and domain keys..." },
      { step: "contacts", text: "Resolving public email handles using LLM..." },
      { step: "verify", text: "Checking SMTP mail exchange relay status..." },
      { step: "analyze", text: "Calculating overall conversion intent fit..." },
      { step: "score", text: "Assigning Priority Lead Score: 94" },
      { step: "queue", text: "Pushing to local SQLite WAL priority queue..." },
      { step: "crm", text: "Saving verified record. Ready for outreach." }
    ]

    let stepIdx = 0
    const interval = setInterval(() => {
      const current = pipelineSequence[stepIdx]
      setCurrentPipelineStep(current.step)
      setPipelineText(current.text)

      // Log updates
      setLiveLogs((prev) => {
        const nextLog = `[${new Date().toLocaleTimeString()}] ${current.text}`
        const updated = [...prev, nextLog]
        return updated.length > 5 ? updated.slice(1) : updated
      })

      // When reaching CRM, append new lead row
      if (current.step === "crm") {
        setLeads((prev) => {
          const hasVortex = prev.some((l) => l.name === "Vortex LLC")
          if (hasVortex) return prev
          return [
            { name: "Vortex LLC", domain: "vortex.io", score: 94, status: "CRM", email: "ceo@vortex.io" },
            ...prev
          ]
        })
        setEmailsVerifiedCount((c) => c + 1)
        setConfidenceScore(99)
        setSyncDelay((d) => Math.max(1, d - 1))

        // Trigger a SQLite transaction log query in terminal
        setSqlQueries((prev) => [
          `INSERT INTO leads (name, domain, score) VALUES ('Vortex LLC', 'vortex.io', 94);`,
          ...prev.slice(0, 4)
        ])
      }

      stepIdx = (stepIdx + 1) % pipelineSequence.length
    }, 2800)

    return () => clearInterval(interval)
  }, [prefersReducedMotion])

  // Initialize and update faint background code statements (scrolling query lists)
  useEffect(() => {
    const lines = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      text: MOCK_BACKGROUND_SQL[i % MOCK_BACKGROUND_SQL.length],
      x: Math.random() * window.innerWidth * 0.8,
      y: Math.random() * window.innerHeight * 0.9,
      speed: Math.random() * 0.2 + 0.05
    }))
    setBgSqlStream(lines)
  }, [])

  // Background Canvas: network grid and mouse proximity attraction logic
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animFrame: number
    let points: Array<{
      x: number
      y: number
      targetX: number
      targetY: number
      vx: number
      vy: number
      size: number
    }> = []

    const initCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      points = []
      const count = window.innerWidth < 768 ? 30 : 70
      for (let i = 0; i < count; i++) {
        points.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          targetX: Math.random() * canvas.width,
          targetY: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          size: Math.random() * 1.5 + 0.8
        })
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Mouse interactive coordinates
      const mx = mouseX.get() + window.innerWidth / 2
      const my = mouseY.get() + window.innerHeight / 2

      // Draw glowing background constellations themed dynamically
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const dx = points[i].x - points[j].x
          const dy = points[i].y - points[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 170) {
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(points[i].x, points[i].y)
            ctx.lineTo(points[j].x, points[j].y)
            ctx.strokeStyle = activeTheme.accentColor
            ctx.globalAlpha = (1 - dist / 170) * 0.28
            ctx.lineWidth = 0.8
            ctx.stroke()
            ctx.restore()
          }
        }
      }

      points.forEach((p) => {
        p.x += p.vx
        p.y += p.vy

        // Repel from mouse smoothly
        const dx = p.x - mx
        const dy = p.y - my
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 220) {
          const force = (220 - dist) / 220
          p.x += (dx / dist) * force * 4.5
          p.y += (dy / dist) * force * 4.5
        }

        // Return slowly to window bounds
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1

        // Draw glowing core node
        ctx.save()
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = activeTheme.accentColor
        ctx.globalAlpha = 0.12
        ctx.fill()

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.globalAlpha = 0.8
        ctx.fill()
        ctx.restore()
      })

      animFrame = requestAnimationFrame(draw)
    }

    window.addEventListener("resize", initCanvas)
    initCanvas()
    
    if (!prefersReducedMotion) {
      draw()
    }

    return () => {
      window.removeEventListener("resize", initCanvas)
      cancelAnimationFrame(animFrame)
    }
  }, [prefersReducedMotion, activeTheme, mouseX, mouseY])

  // Slow update simulation query list coordinates
  useEffect(() => {
    if (prefersReducedMotion) return
    const interval = setInterval(() => {
      setBgSqlStream((prev) =>
        prev.map((line) => {
          let nextY = line.y - line.speed * 8
          if (nextY < -20) {
            nextY = window.innerHeight + 10
            line.x = Math.random() * window.innerWidth * 0.8
          }
          return { ...line, y: nextY }
        })
      )
    }, 50)
    return () => clearInterval(interval)
  }, [prefersReducedMotion])

  // Custom magnetic triggers
  const triggerBtnX = useMotionValue(0)
  const triggerBtnY = useMotionValue(0)
  const trgBtnXSpring = useSpring(triggerBtnX, { damping: 12, stiffness: 120 })
  const trgBtnYSpring = useSpring(triggerBtnY, { damping: 12, stiffness: 120 })

  const handleMagneticMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (prefersReducedMotion) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - (rect.left + rect.width / 2)
    const y = e.clientY - (rect.top + rect.height / 2)
    triggerBtnX.set(x * 0.4)
    triggerBtnY.set(y * 0.4)
  }

  const handleMagneticLeave = () => {
    triggerBtnX.set(0)
    triggerBtnY.set(0)
  }

  return (
    <section className="relative min-h-[95vh] flex items-center justify-center overflow-hidden bg-[#070708] py-20 select-none">
      
      {/* 1. Cinematic Background Texture Layers */}
      <div className="absolute inset-0 noise-bg opacity-70 pointer-events-none z-0" />
      <div className="absolute inset-0 scanlines-overlay opacity-30 pointer-events-none z-0" />
      
      {/* Background Interactive Canvas Points */}
      <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* Ambient Mouse-Tracking Glow backdrop */}
      {!prefersReducedMotion && (
        <motion.div 
          style={{
            x: useTransform(mouseX, (val) => val * 0.45),
            y: useTransform(mouseY, (val) => val * 0.45),
            left: "calc(50% - 250px)",
            top: "calc(50% - 250px)"
          }}
          className={`absolute w-[500px] h-[500px] rounded-full bg-gradient-to-br ${activeTheme.glowGradient} opacity-20 blur-[130px] pointer-events-none z-0`}
        />
      )}

      {/* Background invisible SQL data traces (Reward for looking closer) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden font-mono text-[7px] text-[rgba(255,255,255,0.03)] hidden md:block">
        {bgSqlStream.map((sql) => (
          <div
            key={sql.id}
            style={{
              position: "absolute",
              left: sql.x,
              top: sql.y,
              transition: "transform 0.1s linear"
            }}
          >
            {sql.text}
          </div>
        ))}
      </div>

      {/* Shifting colored ambient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <motion.div 
          animate={prefersReducedMotion ? {} : {
            scale: [1, 1.25, 1],
            x: [0, 60, 0],
            y: [0, -30, 0]
          }}
          transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute top-[10%] left-[5%] h-[400px] w-[400px] rounded-full bg-gradient-to-br ${activeTheme.glowGradient} blur-[120px]`}
        />
        <motion.div 
          animate={prefersReducedMotion ? {} : {
            scale: [1, 1.15, 1],
            x: [0, -50, 0],
            y: [0, 40, 0]
          }}
          transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-[5%] right-[5%] h-[450px] w-[450px] rounded-full bg-gradient-to-br from-[rgba(30,120,250,0.12)] to-[rgba(59,130,246,0.04)] blur-[140px]"
        />
      </div>

      {/* Main Layout Grid wrapper */}
      <div className="container mx-auto px-6 relative z-10 flex flex-col items-center justify-center min-h-[85vh]">
        
        {/* Choreographed Entrance Typography */}
        <div className="text-center max-w-4xl space-y-6">
          
          {/* Release Version Pills */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={entranceStage >= 1 ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2"
          >
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border ${activeTheme.badgeBg} ${activeTheme.badgeText} text-[10px] font-mono uppercase tracking-wider font-semibold`}>
              <Zap className="h-3 w-3 animate-pulse" />
              HUNTARA v1.0.0-beta.1 · Windows Early Beta
            </div>
          </motion.div>

          {/* Stagger reveal engineered header text */}
          <motion.h1
            initial={{ opacity: 0, filter: "blur(6px)", y: 15 }}
            animate={entranceStage >= 2 ? { opacity: 1, filter: "blur(0px)", y: 0 } : {}}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="text-4xl sm:text-7xl font-bold tracking-tight text-white leading-[1.05]"
          >
            Build Local Outreach Pipelines <br />
            <span className={`bg-gradient-to-r ${activeTheme.textGradient} bg-clip-text text-transparent`}>
              Running On Your System.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={entranceStage >= 3 ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed"
          >
            Discover targets, crawl registries, scrape emails, and relay sequence relays directly from your desktop storage. Absolute data security. Built for scale.
          </motion.p>

          {/* Magnetic CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={entranceStage >= 3 ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-wrap items-center justify-center gap-4 pt-4 pb-12"
          >
            <motion.a
              href="/download"
              id="cta-get-started"
              onMouseMove={handleMagneticMove}
              onMouseLeave={handleMagneticLeave}
              style={{ x: trgBtnXSpring, y: trgBtnYSpring }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-6 font-medium text-[var(--primary-foreground)] shadow-[0_4px_24px_rgba(232,98,44,0.3)] hover:shadow-[0_4px_32px_rgba(232,98,44,0.5)] transition-shadow duration-200 text-xs shrink-0 cursor-pointer"
            >
              Get Started <ArrowRight className="h-3.5 w-3.5" />
            </motion.a>
            <a
              href="/docs"
              id="cta-docs"
              className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[rgba(15,15,16,0.35)] backdrop-blur px-6 font-medium text-white hover:border-[var(--border-strong)] transition-all text-xs shrink-0"
            >
              Interactive Docs
            </a>
          </motion.div>
        </div>

        {/* 3D Dashboard Live Operating System Wrapper */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 30 }}
          animate={entranceStage >= 4 ? { opacity: 1, scale: 1 - scrollProgress * 0.05, y: 0 } : {}}
          style={{ 
            rotateX: tiltXSpring, 
            rotateY: tiltYSpring,
            transformStyle: "preserve-3d",
            perspective: 1100
          }}
          className="w-full max-w-4xl relative group"
        >
          {/* Spotlight Cursor Glow */}
          <motion.div 
            style={{
              x: spotlightX,
              y: spotlightY,
            }}
            className={`absolute -inset-[1px] rounded-xl bg-gradient-to-r ${activeTheme.textGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-[8px] pointer-events-none z-0`}
          />

          {/* Interactive Floating Holograms (Parallax Layers) */}
          <div className="absolute inset-0 pointer-events-none z-20">
            {/* Holographic Widget 1: Verified Leads */}
            <motion.div
              style={{ transformStyle: "preserve-3d", zIndex: 30 }}
              animate={prefersReducedMotion ? {} : {
                y: [0, -6, 0],
                rotateZ: [0, 0.5, -0.5, 0]
              }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-8 -left-12 hidden md:block rounded-lg border border-[var(--border-subtle)] bg-[rgba(12,12,13,0.85)] backdrop-blur-md p-3.5 shadow-xl w-44 text-left"
            >
              <div className="text-[7.5px] uppercase font-mono text-[var(--text-tertiary)] tracking-wider">Indexed Database</div>
              <div className="text-sm font-bold font-mono text-white mt-1">
                {emailsVerifiedCount.toLocaleString()} <span className="text-[9px] text-[var(--primary)] font-normal">leads</span>
              </div>
              <div className="h-1.5 w-full bg-[var(--border-subtle)] rounded-full mt-2 overflow-hidden">
                <motion.div 
                  animate={{ width: ["75%", "92%", "75%"] }}
                  transition={{ duration: 10, repeat: Infinity }}
                  className="h-full bg-[var(--primary)]" 
                />
              </div>
            </motion.div>

            {/* Holographic Widget 2: Sync Status */}
            <motion.div
              style={{ transformStyle: "preserve-3d", zIndex: 30 }}
              animate={prefersReducedMotion ? {} : {
                y: [0, 6, 0],
                rotateZ: [0, -0.5, 0.5, 0]
              }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              className="absolute bottom-12 -right-14 hidden md:block rounded-lg border border-[var(--border-subtle)] bg-[rgba(12,12,13,0.85)] backdrop-blur-md p-3.5 shadow-xl w-44 text-left"
            >
              <div className="flex items-center justify-between">
                <span className="text-[7.5px] uppercase font-mono text-[var(--text-tertiary)] tracking-wider">Cloud Engine Sync</span>
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-ping" />
              </div>
              <div className="text-xs font-bold font-mono text-white mt-1">
                SQLite WAL <span className="text-[9px] text-green-400 font-normal">Active</span>
              </div>
              <div className="text-[8px] text-[var(--text-tertiary)] font-mono mt-1">
                Sync delay: {syncDelay}ms
              </div>
            </motion.div>
          </div>

          {/* Main Dashboard Panel Container */}
          <div className="relative rounded-xl border border-[var(--border-subtle)] bg-[rgba(9,9,10,0.78)] backdrop-blur-md shadow-2xl overflow-hidden text-left z-10 fresnel-highlight">
            
            {/* Top Workspace Controls Bar */}
            <div 
              onClick={cycleTheme}
              className="flex h-11 items-center justify-between border-b border-[var(--border-subtle)] bg-[rgba(20,20,22,0.65)] px-4 select-none cursor-pointer hover:bg-[rgba(255,255,255,0.01)] transition-colors"
            >
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/60"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-green-500/60"></span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[9px] text-[var(--text-tertiary)]">
                <HardDrive className="h-3.5 w-3.5 text-[var(--primary)] animate-pulse" />
                <span>workspace_austin_discovery.db</span>
                <span className="text-[8.5px] opacity-40">·</span>
                <span className="text-[8px] border border-[var(--border-subtle)] rounded px-1 text-[var(--text-secondary)] font-sans uppercase">
                  Variant: {themeKey.toUpperCase()} (Click to Cycle)
                </span>
              </div>
              <div className="w-12"></div>
            </div>

            {/* Split workspace layout */}
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_270px] min-h-[440px] bg-[var(--background)]">
              
              {/* Left sidebar navigation */}
              <div className="hidden border-r border-[var(--border-subtle)] p-3.5 md:flex flex-col justify-between select-none font-mono text-[10px] text-[var(--text-secondary)]">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-[10px] font-medium text-white bg-[var(--accent)] bg-opacity-20 border-l-2 border-[var(--primary)]">
                    <Monitor className="h-3.5 w-3.5 text-[var(--primary)]" />
                    Live Scrapers
                  </div>
                  <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-[10px] font-medium hover:text-white hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <Cpu className="h-3.5 w-3.5" />
                    Agent Tools
                  </div>
                  <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-[10px] font-medium hover:text-white hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <Database className="h-3.5 w-3.5" />
                    SQLite Console
                  </div>
                </div>

                <div className="border-t border-[var(--border-subtle)] pt-3 flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--primary)] text-[9px] font-bold text-[var(--primary-foreground)]">
                    LF
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white leading-tight">get@leads.io</div>
                    <div className="truncate text-[8px] text-[var(--text-tertiary)]">Local Workspace</div>
                  </div>
                </div>
              </div>

              {/* Central Operations Panel */}
              <div className="flex flex-col p-5 border-r border-[var(--border-subtle)] min-w-0 justify-between">
                <div>
                  
                  {/* Real-time lead pipeline indicator visualizer */}
                  <div className="mb-4 bg-[rgba(20,20,22,0.4)] border border-[var(--border-subtle)] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[8.5px] uppercase tracking-wider text-[var(--text-secondary)]">Lead Discovery Pipeline</span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[8px] font-mono">
                        <Play className="h-2 w-2 fill-primary" /> Active
                      </span>
                    </div>

                    {/* Flowing Conduits visualizer */}
                    <div className="grid grid-cols-4 gap-1 select-none font-mono text-[7.5px] text-center">
                      <div className={`p-1.5 rounded border transition-colors ${currentPipelineStep === "found" || currentPipelineStep === "crawl" ? "border-primary bg-primary/5 text-white" : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"}`}>
                        <Globe className="h-3 w-3 mx-auto mb-1 text-[var(--text-secondary)]" />
                        1. Crawl Web
                      </div>
                      <div className={`p-1.5 rounded border transition-colors ${currentPipelineStep === "whois" || currentPipelineStep === "contacts" ? "border-primary bg-primary/5 text-white" : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"}`}>
                        <Mail className="h-3 w-3 mx-auto mb-1 text-[var(--text-secondary)]" />
                        2. Scrape Email
                      </div>
                      <div className={`p-1.5 rounded border transition-colors ${currentPipelineStep === "verify" ? "border-primary bg-primary/5 text-white" : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"}`}>
                        <Check className="h-3 w-3 mx-auto mb-1 text-[var(--text-secondary)]" />
                        3. Verify SMTP
                      </div>
                      <div className={`p-1.5 rounded border transition-colors ${currentPipelineStep === "analyze" || currentPipelineStep === "score" || currentPipelineStep === "crm" ? "border-primary bg-primary/5 text-white" : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"}`}>
                        <Zap className="h-3 w-3 mx-auto mb-1 text-[var(--text-secondary)]" />
                        4. AI Scored
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-3 select-none">
                    <h3 className="text-xs font-bold text-white font-mono">Active Database Records</h3>
                  </div>

                  {/* CRM Table */}
                  <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--card)]">
                    <table className="w-full text-left border-collapse font-mono text-[9.5px]">
                      <thead>
                        <tr className="bg-[rgba(20,20,21,0.5)] text-[8.5px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-subtle)] select-none">
                          <th className="px-3 py-2 w-7">
                            <input type="checkbox" checked disabled className="rounded border-[var(--border-subtle)] bg-[var(--background)] opacity-60" />
                          </th>
                          <th className="px-3 py-2 font-normal">Company Domain</th>
                          <th className="px-3 py-2 font-normal">Contact Target</th>
                          <th className="px-3 py-2 font-normal text-right">Priority Fit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] text-[9.5px]">
                        {leads.map((lead, idx) => {
                          return (
                            <motion.tr
                              key={lead.domain}
                              initial={prefersReducedMotion ? {} : { opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="hover:bg-[rgba(255,255,255,0.015)] transition-colors"
                            >
                              <td className="px-3 py-2">
                                <input type="checkbox" checked disabled className="rounded border-[var(--border-subtle)] bg-[var(--background)] pointer-events-none" />
                              </td>
                              <td className="px-3 py-2 font-medium text-white">{lead.domain}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{lead.email}</td>
                              <td className="px-3 py-2 text-right text-[var(--primary)] font-semibold">{lead.score}%</td>
                            </motion.tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SQLite WAL Terminal & Live query ticker */}
                <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--background)] p-3">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 mb-2 select-none">
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75"></span>
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--success)]"></span>
                      </span>
                      <span className="font-mono text-[8.5px] uppercase tracking-wider text-[var(--text-secondary)] font-bold">
                        SQLite Log Relay
                      </span>
                    </div>
                    <span className="font-mono text-[8px] text-[var(--text-tertiary)]">
                      PRAGMA journal_mode=WAL
                    </span>
                  </div>

                  <div className="min-h-[85px] font-mono text-[9px] leading-relaxed text-[var(--text-secondary)] overflow-hidden flex flex-col justify-end">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {liveLogs.map((log, index) => (
                        <motion.div
                          key={log + index}
                          initial={prefersReducedMotion ? {} : { opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={prefersReducedMotion ? {} : { opacity: 0, y: -4 }}
                          transition={{ duration: 0.18 }}
                          className="flex gap-1.5 py-[1px]"
                        >
                          <span className="text-[var(--text-tertiary)] shrink-0 select-none">·</span>
                          <span className="text-white truncate">{log}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>

              </div>

              {/* Right Detail AI score details panel */}
              <div className="hidden lg:flex flex-col p-4 select-none min-w-0 bg-[rgba(20,20,22,0.2)] w-[270px] shrink-0 font-mono">
                <div className="flex items-start justify-between mb-4 border-b border-[var(--border-subtle)] pb-3">
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-white truncate leading-tight">
                      AI Lead Qualification
                    </h4>
                    <span className="text-[8.5px] text-[var(--text-tertiary)] truncate block mt-0.5">
                      ollama · local-llama3.1
                    </span>
                  </div>
                </div>

                <div className="flex-grow text-[9.5px] leading-relaxed text-[var(--text-secondary)] space-y-4 text-left">
                  
                  {/* Display active running query */}
                  <div className="bg-[rgba(10,10,11,0.5)] border border-[var(--border-subtle)] rounded p-2.5">
                    <div className="text-[8px] text-[var(--text-tertiary)] uppercase font-semibold mb-1">Transaction Stream</div>
                    <div className="text-[8.5px] text-green-400 font-mono leading-tight whitespace-pre-wrap break-all">
                      {sqlQueries[0] || "SELECT * FROM leads ORDER BY score DESC;"}
                    </div>
                  </div>

                  <div>
                    <div className="text-[8px] text-[var(--text-tertiary)] uppercase font-semibold">Active Scraper Loop</div>
                    <div className="text-[9.5px] text-white mt-1 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
                      {pipelineText}
                    </div>
                  </div>

                  <div className="border-t border-[var(--border-subtle)] pt-3.5 space-y-2">
                    <div className="text-[8px] text-[var(--text-tertiary)] uppercase font-semibold">Discovery State</div>
                    <div className="grid grid-cols-2 gap-2 text-[9px] font-semibold text-[var(--text-secondary)]">
                      <div className="p-2 border border-[var(--border-subtle)] rounded bg-[rgba(10,10,11,0.3)]">
                        <div className="text-[7.5px] text-[var(--text-tertiary)] uppercase font-normal">Confidence</div>
                        <div className="text-white mt-0.5">{confidenceScore}%</div>
                      </div>
                      <div className="p-2 border border-[var(--border-subtle)] rounded bg-[rgba(10,10,11,0.3)]">
                        <div className="text-[7.5px] text-[var(--text-tertiary)] uppercase font-normal">Workers</div>
                        <div className="text-white mt-0.5">16 threads</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </motion.div>

      </div>
    </section>
  )
}
