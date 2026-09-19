"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { HelpCircle, ChevronRight, HelpCircle as HelpIcon } from "lucide-react"

interface FAQItemProps {
  question: string
  answer: string
}

function FAQAccordionItem({ question, answer }: FAQItemProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border border-[var(--border)] rounded-lg bg-[var(--card)] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between text-left font-medium text-xs text-[var(--foreground)] hover:bg-[var(--background)] transition-all select-none cursor-pointer"
      >
        <span className="pr-4">{question}</span>
        <motion.span
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-[var(--text-tertiary)] shrink-0"
        >
          <ChevronRight className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden bg-[var(--background)] border-t border-[var(--border-subtle)]"
          >
            <p className="px-5 py-4 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function FAQPage() {
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

  const faqs = [
    {
      question: "Is HUNTARA really local-first?",
      answer: "Yes. All code scrapers, contact enricher parser loops, and email TLS handshakes run directly on your own hardware using Electron worker threads. Your SQLite database is stored locally in your configuration folders. We cannot read your leads or credentials."
    },
    {
      question: "How do you avoid getting SMTP accounts flagged?",
      answer: "Since HUNTARA dispatches emails locally, it coordinates directly with your own SMTP configs. You are responsible for setting up proper DNS records (SPF, DKIM, DMARC) on your sending domains. The app schedules dispatch intervals with randomized pauses to prevent sending bursts."
    },
    {
      question: "Does WAL mode prevent SQLite table locking?",
      answer: "Yes. SQLite Write-Ahead Logging (WAL) allows concurrent readers to query tables while scraper worker threads write newly enriched contact rows in the background. Checkpointing checks occur automatically in idle states."
    },
    {
      question: "Can I migrate my database to another machine?",
      answer: "Yes. You can copy your `.db` SQLite files from the workspace directory and open them on any computer running the HUNTARA client. There are no vendor locks."
    },
    {
      question: "How does the Chromium Discovery Scraper operate locally?",
      answer: "The scraper launches a headless Chromium instance via Playwright inside a separate task process. It crawls yellow pages and maps, parses domain anchors, handles redirects, and stream-writes the qualified domains into SQLite write pools."
    },
    {
      question: "What local AI models are supported for enrichment qualification?",
      answer: "We support offline LLM inference via local Ollama wrappers (such as llama3.1, mistral, or phi3). This allows your client to automatically analyze domain content and determine ICP status entirely on your own GPU/CPU without leaking data to API aggregators."
    },
    {
      question: "Is there an auto-updater in the desktop environment?",
      answer: "Yes. The Update Manager checks public tags on our official GitHub release channel, cryptographically verifies archive packages using SHA-256 hash checks, and schedules background updates during app idle times."
    },
    {
      question: "How does the multi-process task watchdog ensure worker stability?",
      answer: "All intense scraping routines are executed inside subprocesses. A heartbeat watchdog monitors their health using periodic ping/pong messages. If a subprocess crashes, the app logs the exception code and triggers an automatic state recovery."
    }
  ]

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-3xl mx-auto space-y-12"
      >
        {/* Header Block */}
        <div className="space-y-4">
          <motion.div variants={childVariants} className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
            Support Desk
          </motion.div>
          <motion.h1 variants={childVariants} className="text-3xl font-semibold tracking-tight text-[var(--foreground)] md:text-4xl">
            Frequently Asked Questions
          </motion.h1>
          <motion.p variants={childVariants} className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Detailed answers regarding local-first databases, encryption parameters, and SMTP campaigns.
          </motion.p>
        </div>

        {/* FAQs List */}
        <motion.div variants={childVariants} className="space-y-4">
          {faqs.map((faq, idx) => (
            <FAQAccordionItem key={idx} question={faq.question} answer={faq.answer} />
          ))}
        </motion.div>
      </motion.div>
    </div>
  )
}
