"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import Link from "next/link"
import { Menu, X } from "lucide-react"

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <motion.nav 
        className="sticky top-0 z-50 flex h-16 items-center border-b border-[var(--border-subtle)] bg-[rgba(10,10,11,0.86)] backdrop-blur-md"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="container mx-auto flex items-center justify-between px-6">
          <Link href="/" id="nav-brand" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-[var(--foreground)] group">
            <motion.div
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
              className="relative flex h-[26px] w-[26px] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--card)] shadow-[0_1px_4px_rgba(0,0,0,0.2)]"
            >
              <img src="/app-icon-dark.png" className="h-[18px] w-[18px] object-contain transition-all duration-300 group-hover:drop-shadow-[0_0_6px_rgba(250,113,37,0.5)]" alt="HUNTARA Logo" />
            </motion.div>
            HUNTARA
          </Link>
          <div className="hidden gap-8 text-xs font-medium text-[var(--muted-foreground)] md:flex">
            <Link href="/features" id="nav-link-features" className="hover:text-[var(--foreground)] transition-colors duration-150">Features</Link>
            <Link href="/architecture" id="nav-link-architecture" className="hover:text-[var(--foreground)] transition-colors duration-150">Architecture</Link>
            <Link href="/pricing" id="nav-link-pricing" className="hover:text-[var(--foreground)] transition-colors duration-150">Pricing</Link>
            <Link href="/roadmap" id="nav-link-roadmap" className="hover:text-[var(--foreground)] transition-colors duration-150">Roadmap</Link>
            <Link href="/faq" id="nav-link-faq" className="hover:text-[var(--foreground)] transition-colors duration-150">FAQ</Link>
            <Link href="/docs" id="nav-link-docs" className="hover:text-[var(--foreground)] transition-colors duration-150">Docs</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/releases" id="nav-link-releases" className="hidden sm:inline-flex h-9 items-center justify-center px-4 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">
              Releases
            </Link>
            <Link 
              href="/download" 
              id="nav-link-download"
              className="hidden sm:inline-flex h-9 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-xs font-medium text-[var(--primary-foreground)] hover:bg-[oklch(0.698_0.167_41.6)] transition-colors duration-150"
            >
              Download
            </Link>
            {/* Hamburger Button */}
            <button 
              onClick={() => setMobileOpen(!mobileOpen)}
              id="nav-menu-toggle"
              className="p-1 rounded md:hidden hover:bg-[var(--card)] transition-colors cursor-pointer"
            >
              {mobileOpen ? <X className="h-5 w-5 text-white" /> : <Menu className="h-5 w-5 text-white" />}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="fixed inset-x-0 top-16 z-40 border-b border-[var(--border-subtle)] bg-[rgba(10,10,11,0.95)] backdrop-blur-md overflow-hidden md:hidden"
          >
            <div className="flex flex-col gap-4 p-6 text-sm font-medium text-[var(--muted-foreground)]">
              <Link href="/features" onClick={() => setMobileOpen(false)} className="hover:text-[var(--foreground)] transition-colors py-1.5">Features</Link>
              <Link href="/architecture" onClick={() => setMobileOpen(false)} className="hover:text-[var(--foreground)] transition-colors py-1.5">Architecture</Link>
              <Link href="/pricing" onClick={() => setMobileOpen(false)} className="hover:text-[var(--foreground)] transition-colors py-1.5">Pricing</Link>
              <Link href="/roadmap" onClick={() => setMobileOpen(false)} className="hover:text-[var(--foreground)] transition-colors py-1.5">Roadmap</Link>
              <Link href="/faq" onClick={() => setMobileOpen(false)} className="hover:text-[var(--foreground)] transition-colors py-1.5">FAQ</Link>
              <Link href="/docs" onClick={() => setMobileOpen(false)} className="hover:text-[var(--foreground)] transition-colors py-1.5">Docs</Link>
              <div className="h-px bg-[var(--border-subtle)] my-2" />
              <Link href="/releases" onClick={() => setMobileOpen(false)} className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] text-xs font-semibold hover:text-[var(--foreground)] transition-colors">
                Releases
              </Link>
              <Link href="/download" onClick={() => setMobileOpen(false)} className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--primary)] text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-colors">
                Download HUNTARA
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
