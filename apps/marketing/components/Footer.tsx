"use client"

import React from "react"
import Link from "next/link"
import { TextHoverEffect } from "./ui/text-hover-effect"

export function Footer() {
  return (
    <footer className="border-t border-[var(--border-subtle)] bg-[var(--background)] py-16 text-xs text-[var(--text-tertiary)]">
      <div className="container mx-auto px-6 relative">

        {/* Footer Top Grid */}
        <div className="grid grid-cols-1 md:grid-cols-[1.6fr_repeat(4,1fr)] gap-8 mb-12 select-none">

          {/* Brand Col */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--foreground)]">
              <img src="/huntara-mark.png" alt="HUNTARA" className="h-[22px] w-[22px] object-contain" />
              HUNTARA
            </Link>
            <p className="leading-relaxed max-w-[220px]">
              HUNTARA helps businesses find and understand their next customers.
            </p>
          </div>

          {/* Product Col */}
          <div className="space-y-4">
            <h5 className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Product</h5>
            <ul className="space-y-2.5">
              <li><Link href="/features" id="footer-link-features" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Features</Link></li>
              <li><Link href="/architecture" id="footer-link-architecture" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Architecture</Link></li>
              <li><Link href="/pricing" id="footer-link-pricing" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Pricing</Link></li>
              <li><Link href="/download" id="footer-link-download" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Download</Link></li>
            </ul>
          </div>

          {/* Resources Col */}
          <div className="space-y-4">
            <h5 className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Resources</h5>
            <ul className="space-y-2.5">
              <li><Link href="/docs" id="footer-link-docs" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Documentation</Link></li>
              <li><Link href="/changelog" id="footer-link-changelog" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Changelog</Link></li>
              <li><Link href="/releases" id="footer-link-releases" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Releases</Link></li>
              <li><Link href="/roadmap" id="footer-link-roadmap" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Roadmap</Link></li>
              <li><Link href="/faq" id="footer-link-faq" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">FAQ</Link></li>
            </ul>
          </div>

          {/* Company Col */}
          <div className="space-y-4">
            <h5 className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Company</h5>
            <ul className="space-y-2.5">
              <li><Link href="/about" id="footer-link-about" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">About</Link></li>
              <li><Link href="/blog" id="footer-link-blog" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Blog</Link></li>
              <li><Link href="/contact" id="footer-link-contact" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Contact</Link></li>
            </ul>
          </div>

          {/* Legal Col */}
          <div className="space-y-4">
            <h5 className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Legal</h5>
            <ul className="space-y-2.5">
              <li><Link href="/privacy" id="footer-link-privacy" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Privacy</Link></li>
              <li><Link href="/terms" id="footer-link-terms" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Terms</Link></li>
              <li><Link href="/security" id="footer-link-security" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Security</Link></li>
              <li><Link href="/brand" id="footer-link-brand" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-150">Brand Assets</Link></li>
            </ul>
          </div>

        </div>

        {/* Footer Bottom */}
        <div className="border-t border-[var(--border-subtle)] pt-6 flex flex-col md:flex-row justify-between gap-4 select-none">
          <div className="flex gap-4 items-center">
            <span>© 2026 HUNTARA. All rights reserved.</span>
            <span className="h-3 w-px bg-[var(--border-subtle)]"></span>
            <Link href="/status" className="hover:text-[var(--foreground)] flex items-center gap-1.5 transition-colors duration-150">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse"></span>
              All Systems Operational
            </Link>
          </div>
          <div className="flex gap-6 items-center">
            <Link href="/docs" className="hover:text-[var(--foreground)] transition-colors duration-150">Documentation</Link>
            <Link href="/releases" className="hover:text-[var(--foreground)] transition-colors duration-150">Releases</Link>
            <a href="https://github.com/kjxcodez/huntara" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--foreground)] transition-colors duration-150 font-mono">
              GitHub
            </a>
          </div>
        </div>

        {/* Big Background Outline Text */}
        <div className="w-full text-center select-none relative group flex items-center justify-center overflow-visible z-0 pointer-events-none">

          <div className="h-[40dvh] w-screen flex items-center justify-center pointer-events-auto z-10">
            <TextHoverEffect text="HUNTARA" />
          </div>
        </div>
      </div>
    </footer>
  )
}
