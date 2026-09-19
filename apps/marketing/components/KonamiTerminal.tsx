"use client"

import React, { useState, useEffect, useRef } from "react"
import { Terminal, X, ChevronRight } from "lucide-react"

const KONAMI_CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a"
]

export function KonamiTerminal() {
  const [isOpen, setIsOpen] = useState(false)
  const [history, setHistory] = useState<string[]>([
    "HUNTARA v1.0.0 (Local-First SQL Terminal Shell)",
    "Type 'help' to list available system operations.",
    ""
  ])
  const [input, setInput] = useState("")
  const konamiIndex = useRef(0)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check Konami Code progress
      const targetKey = KONAMI_CODE[konamiIndex.current]
      
      if (e.key === targetKey) {
        konamiIndex.current++
        if (konamiIndex.current === KONAMI_CODE.length) {
          setIsOpen(true)
          konamiIndex.current = 0
        }
      } else {
        // Reset code on mismatch
        konamiIndex.current = 0
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Auto-focus input when terminal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  // Scroll to bottom when history changes
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [history])

  if (!isOpen) return null

  const handleCommand = (cmd: string) => {
    const trimmed = cmd.trim().toLowerCase()
    let response: string[] = []

    if (trimmed === "help") {
      response = [
        "Available SQL & CLI operations:",
        "  ls or show tables  - List available SQLite data models",
        "  select * from [t]  - Query table contents",
        "  whoami             - Show current active credentials",
        "  clear              - Wipe terminal logs",
        "  exit               - Close session"
      ]
    } else if (trimmed === "ls" || trimmed === "show tables") {
      response = [
        "Tables indexed in workspace_austin_discovery.db:",
        "  -> leads",
        "  -> config",
        "  -> sequences"
      ]
    } else if (trimmed === "whoami") {
      response = [
        "Current credentials state:",
        "  User: operator@austin.io",
        "  Role: Administrator",
        "  Local WAL check: Passed (100% integrity)"
      ]
    } else if (trimmed.startsWith("select * from leads")) {
      response = [
        "+----+--------------------+-------------------+-------+",
        "| ID | Domain             | Verified Email    | Score |",
        "+----+--------------------+-------------------+-------+",
        "|  1 | vortex-solutions   | ceo@vortex.io     |    94 |",
        "|  2 | greentech-models   | info@greentech.io |    87 |",
        "|  3 | austin-solar-dev   | dev@austinsolar   |    81 |",
        "+----+--------------------+-------------------+-------+",
        "3 rows matching local cache query."
      ]
    } else if (trimmed.startsWith("select * from config")) {
      response = [
        "+-------------------+--------------------------+",
        "| Variable          | Value                    |",
        "+-------------------+--------------------------+",
        "| database_mode     | SQLite WAL               |",
        "| telemetry_enabled | FALSE (Zero Telemetry)   |",
        "| local_ai_model    | Ollama Llama 3.1         |",
        "| smtp_port         | 587 (TLS handshake)      |",
        "+-------------------+--------------------------+"
      ]
    } else if (trimmed.startsWith("select * from sequences")) {
      response = [
        "+----+------------------------+----------+---------+",
        "| ID | Campaign Name          | Interval | Enabled |",
        "+----+------------------------+----------+---------+",
        "|  1 | Austin Solar Outreach  |   1200ms |    TRUE |",
        "|  2 | Cold Intro Pipeline    |   3600ms |   FALSE |",
        "+----+------------------------+----------+---------+"
      ]
    } else if (trimmed === "clear") {
      setHistory([])
      return
    } else if (trimmed === "exit") {
      setIsOpen(false)
      return
    } else if (trimmed === "") {
      response = [""]
    } else {
      response = [
        `SQL Error: unrecognized command or syntax error near "${cmd}"`,
        "Type 'help' to review available schema operations."
      ]
    }

    setHistory((prev) => [...prev, `> ${cmd}`, ...response, ""])
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#09090b] border border-[var(--border-strong)] rounded-lg shadow-2xl overflow-hidden font-mono flex flex-col h-[400px]">
        {/* Terminal Header */}
        <div className="bg-[#121214] border-b border-[var(--border-subtle)] px-4 py-2 flex items-center justify-between select-none">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Terminal className="h-4 w-4 text-[var(--primary)]" />
            <span>SQLite Local Workspace Shell</span>
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="text-[var(--text-tertiary)] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Terminal Outputs */}
        <div className="flex-1 p-4 overflow-y-auto text-[11px] text-[var(--text-secondary)] space-y-1 custom-scrollbar text-left">
          {history.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap leading-relaxed">
              {line}
            </div>
          ))}
          <div ref={terminalEndRef} />
        </div>

        {/* Terminal Input Bar */}
        <form 
          onSubmit={(e) => {
            e.preventDefault()
            handleCommand(input)
            setInput("")
          }}
          className="border-t border-[var(--border-subtle)] bg-[#070708] px-4 py-3 flex items-center gap-2"
        >
          <ChevronRight className="h-3.5 w-3.5 text-[var(--primary)] shrink-0" />
          <input 
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="select * from leads;"
            className="flex-grow bg-transparent text-[11px] text-white focus:outline-none placeholder-[var(--text-tertiary)] font-mono"
          />
        </form>
      </div>
    </div>
  )
}
