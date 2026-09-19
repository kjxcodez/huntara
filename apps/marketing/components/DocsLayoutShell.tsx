"use client"

import React, { useState, useEffect, useRef } from "react"
import { ChevronRight, Menu, X, Clock, Edit3, ArrowLeft, ArrowRight, Book, ShieldAlert, FileText } from "lucide-react"
import { DocsSearch } from "./DocsSearch"
import { NavGroup, NavItem } from "../lib/mdx-utils"

interface Heading {
  level: number
  text: string
  id: string
}

interface DocsLayoutShellProps {
  children: React.ReactNode
  navigation: NavGroup[]
  headings: Heading[]
  activeArticleId: string
  activeTitle: string
  activeCategory: string
  activeDescription?: string
  readingTime: number
  prevArticle: NavItem | null
  nextArticle: NavItem | null
  slugStr: string
}

export function DocsLayoutShell({
  children,
  navigation,
  headings,
  activeArticleId,
  activeTitle,
  activeCategory,
  activeDescription,
  readingTime,
  prevArticle,
  nextArticle,
  slugStr
}: DocsLayoutShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeHeadingId, setActiveHeadingId] = useState<string>("")
  const contentRef = useRef<HTMLDivElement>(null)

  // Scroll spy to highlight active TOC heading
  useEffect(() => {
    const headingElements = headings.map(h => document.getElementById(h.id)).filter(Boolean) as HTMLElement[]

    const handleScroll = () => {
      const scrollPosition = window.scrollY + 120

      let currentActive = ""
      for (let i = 0; i < headingElements.length; i++) {
        const el = headingElements[i]
        if (el.offsetTop <= scrollPosition) {
          currentActive = el.id
        } else {
          break
        }
      }
      setActiveHeadingId(currentActive || (headings[0]?.id || ""))
    }

    window.addEventListener("scroll", handleScroll)
    handleScroll()
    return () => window.removeEventListener("scroll", handleScroll)
  }, [headings])

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      const offset = 90
      const bodyRect = document.body.getBoundingClientRect().top
      const elementRect = element.getBoundingClientRect().top
      const elementPosition = elementRect - bodyRect
      const offsetPosition = elementPosition - offset

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      })
      setActiveHeadingId(id)
    }
  }

  return (
    <div className="container mx-auto px-6 py-12 min-h-[85vh] text-left">
      {/* Mobile Header Bar */}
      <div className="md:hidden flex items-center justify-between border-b border-[var(--border-subtle)] pb-4 mb-6 select-none">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)] border border-[var(--border-subtle)] px-3 py-1.5 rounded bg-[var(--card)] hover:bg-[var(--accent)]"
        >
          <Menu className="h-4 w-4 text-[var(--primary)]" />
          Menu Outline
        </button>
        <div className="w-40">
          <DocsSearch />
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[220px_1fr_200px] gap-8">

        {/* Left Sidebar - Desktop */}
        <div className="hidden md:block space-y-6 select-none border-r border-[var(--border-subtle)] pr-6 sticky top-20 self-start">
          <div className="w-full">
            <DocsSearch />
          </div>

          <div className="space-y-5 overflow-y-auto max-h-[70vh] custom-scrollbar">
            {navigation.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <h4 className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                  {group.category}
                </h4>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = activeArticleId === item.id
                    const IconComp = item.category === "Security" ? ShieldAlert : item.category === "ADRs" ? FileText : Book
                    return (
                      <a
                        key={item.id}
                        href={item.url}
                        className={`flex w-full items-center gap-2 px-2.5 py-1.5 rounded text-[11.5px] font-medium transition-colors duration-150 ${isActive
                            ? "bg-[rgba(232,98,44,0.06)] text-[var(--primary)] border-l-2 border-[var(--primary)] pl-[8px]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                          }`}
                      >
                        <IconComp className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </a>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden bg-black/80 backdrop-blur-sm">
            <div className="w-72 bg-[var(--card)] border-r border-[var(--border)] p-6 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-mono text-[var(--primary)]">Documentation</span>
                  <button onClick={() => setMobileMenuOpen(false)} className="p-1 rounded hover:bg-[var(--accent)]">
                    <X className="h-4.5 w-4.5 text-[var(--foreground)]" />
                  </button>
                </div>

                <div className="space-y-5">
                  {navigation.map((group) => (
                    <div key={group.category} className="space-y-1.5">
                      <h4 className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                        {group.category}
                      </h4>
                      <div className="space-y-0.5">
                        {group.items.map((item) => {
                          const isActive = activeArticleId === item.id
                          return (
                            <a
                              key={item.id}
                              href={item.url}
                              onClick={() => setMobileMenuOpen(false)}
                              className={`flex w-full items-center gap-2 px-2.5 py-1.5 rounded text-[11.5px] font-medium transition-colors duration-150 ${isActive
                                  ? "bg-[rgba(232,98,44,0.06)] text-[var(--primary)] border-l-2 border-[var(--primary)] pl-[8px]"
                                  : "text-[var(--text-secondary)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                                }`}
                            >
                              <span className="truncate">{item.title}</span>
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1" onClick={() => setMobileMenuOpen(false)}></div>
          </div>
        )}

        {/* Center Main Content Panel */}
        <div className="space-y-8 min-w-0 pr-0 md:pr-4">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-tertiary)] select-none">
            <span className="hover:text-[var(--foreground)]">Docs</span>
            <ChevronRight className="h-2.5 w-2.5" />
            <span className="hover:text-[var(--foreground)]">{activeCategory}</span>
            <ChevronRight className="h-2.5 w-2.5" />
            <span className="text-[var(--foreground)] truncate">{activeTitle}</span>
          </div>

          {/* Article Header */}
          <div className="border-b border-[var(--border-subtle)] pb-5 space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
              {activeTitle}
            </h1>
            {activeDescription && (
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed m-0">{activeDescription}</p>
            )}
            <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--text-tertiary)] select-none pt-2">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {readingTime} min read
              </span>
              <span>•</span>
              <a
                href={`https://github.com/kjxcodez/huntara/edit/main/docs/${slugStr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-[var(--foreground)]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit on GitHub
              </a>
            </div>
          </div>

          {/* Compiled MDX Content */}
          <div
            ref={contentRef}
            className="doc-content prose prose-invert max-w-none"
          >
            {children}
          </div>

          {/* Previous/Next Navigation */}
          <div className="grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-6 mt-12 select-none">
            {prevArticle ? (
              <a
                href={prevArticle.url}
                className="flex flex-col items-start gap-1 p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--card)] hover:border-[var(--border-strong)] text-left cursor-pointer transition-all"
              >
                <span className="text-[9px] font-mono text-[var(--text-tertiary)] flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> PREVIOUS
                </span>
                <span className="text-[11.5px] font-semibold text-[var(--foreground)] truncate w-full">
                  {prevArticle.title}
                </span>
              </a>
            ) : <div />}

            {nextArticle ? (
              <a
                href={nextArticle.url}
                className="flex flex-col items-end gap-1 p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--card)] hover:border-[var(--border-strong)] text-right cursor-pointer transition-all"
              >
                <span className="text-[9px] font-mono text-[var(--text-tertiary)] flex items-center gap-1">
                  NEXT <ArrowRight className="h-3 w-3" />
                </span>
                <span className="text-[11.5px] font-semibold text-[var(--foreground)] truncate w-full">
                  {nextArticle.title}
                </span>
              </a>
            ) : <div />}
          </div>
        </div>

        {/* Right Table of Contents Sidebar Outline */}
        <div className="hidden lg:block space-y-4 select-none border-l border-[var(--border-subtle)] pl-4 sticky top-20 self-start">
          {headings.length > 0 && (
            <>
              <h4 className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-semibold font-sans">
                On this page
              </h4>
              <div className="space-y-1.5 text-[11px] leading-normal font-medium">
                {headings.map((heading) => {
                  const isActive = activeHeadingId === heading.id
                  const indentClass = heading.level === 3 ? "pl-3 text-[10.5px] opacity-80" : ""

                  return (
                    <button
                      key={heading.id}
                      onClick={() => scrollToHeading(heading.id)}
                      className={`block w-full text-left truncate transition-colors duration-150 cursor-pointer ${indentClass} ${isActive
                          ? "text-[var(--primary)] font-semibold"
                          : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                        }`}
                    >
                      {heading.text}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
