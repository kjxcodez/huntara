import React from "react"
import Link from "next/link"
import { Monitor, Apple, Terminal, ArrowRight, Tag } from "lucide-react"
import { getAllReleases, PlatformId } from "../../lib/generated-releases"

function PlatformIcon({ id, className }: { id: PlatformId; className?: string }) {
  if (id === "windows") return <Monitor className={className || "h-3.5 w-3.5"} />
  if (id === "macos") return <Apple className={className || "h-3.5 w-3.5"} />
  return <Terminal className={className || "h-3.5 w-3.5"} />
}

export default function ReleasesIndexPage() {
  const releases = getAllReleases()

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <div className="max-w-3xl mx-auto space-y-12">
        {/* Header Block */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
            <Tag className="h-3 w-3 text-primary" />
            Release Archive
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-5xl">
            HUNTARA Releases
          </h1>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Archive of official HUNTARA desktop releases. Discover the companies worth selling to.
          </p>
        </div>

        {/* Releases List */}
        <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
          {releases.map((rel) => (
            <article key={rel.version} className="py-8 space-y-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Link 
                    href={`/releases/${rel.version}`}
                    className="text-xl font-bold text-[var(--foreground)] hover:text-primary transition-colors font-mono"
                  >
                    HUNTARA {rel.version}
                  </Link>
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${
                      rel.status === "stable"
                        ? "bg-[rgba(63,178,127,0.12)] text-[#3FB27F] border-[rgba(63,178,127,0.2)]"
                        : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    }`}
                  >
                    {rel.status === "stable" ? "Stable" : "Pre-release"}
                  </span>
                </div>
                <time 
                  dateTime={rel.releasedAt} 
                  className="text-xs font-mono text-[var(--text-tertiary)]"
                >
                  {rel.releasedDateFormatted}
                </time>
              </div>

              <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                {rel.summary}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mr-1">
                    Available on:
                  </span>
                  {rel.platforms.map((plat) => (
                    <Link
                      key={plat.id}
                      href={`/releases/${rel.version}/${plat.id}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--card)] border border-[var(--border-subtle)] hover:border-primary/50 text-[11px] font-medium text-[var(--foreground)] hover:text-primary transition-colors"
                    >
                      <PlatformIcon id={plat.id} className="h-3 w-3 text-[var(--text-secondary)]" />
                      {plat.label}
                    </Link>
                  ))}
                </div>

                <Link
                  href={`/releases/${rel.version}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  View release <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
