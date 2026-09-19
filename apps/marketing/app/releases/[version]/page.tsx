import React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Monitor, Apple, Terminal, ArrowDownToLine, ChevronRight, Tag, ArrowRight } from "lucide-react"
import { 
  getAllReleases, 
  getReleaseByVersion, 
  PlatformId 
} from "../../../lib/generated-releases"

type Props = {
  params: Promise<{ version: string }>
}

function PlatformIcon({ id, className }: { id: PlatformId; className?: string }) {
  if (id === "windows") return <Monitor className={className || "h-5 w-5"} />
  if (id === "macos") return <Apple className={className || "h-5 w-5"} />
  return <Terminal className={className || "h-5 w-5"} />
}

export async function generateStaticParams() {
  const releases = getAllReleases()
  return releases.map((rel) => ({
    version: rel.version
  }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params
  const release = getReleaseByVersion(version)
  if (!release) {
    return {
      title: "Release Not Found | HUNTARA"
    }
  }

  const platformsList = release.platforms.map((p) => p.label).join(", ")
  return {
    title: `HUNTARA ${release.version} | Releases`,
    description: `Official HUNTARA ${release.version} download. Available for ${platformsList}. Local-first lead discovery platform.`
  }
}

export default async function VersionDetailPage({ params }: Props) {
  const { version } = await params
  const release = getReleaseByVersion(version)

  if (!release) {
    notFound()
  }

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-mono text-[var(--text-tertiary)]">
          <Link href="/releases" className="hover:text-[var(--foreground)] transition-colors">
            Releases
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-[var(--foreground)] font-semibold">{release.version}</span>
        </nav>

        {/* Release Header */}
        <div className="space-y-4 border-b border-[var(--border-subtle)] pb-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] uppercase tracking-wider font-mono">
              <Tag className="h-3 w-3" />
              {release.status === "stable" ? "Stable Release" : "Pre-release"}
            </span>
            <time dateTime={release.releasedAt} className="text-xs font-mono text-[var(--text-tertiary)]">
              Released {release.releasedDateFormatted}
            </time>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-[var(--foreground)] md:text-5xl font-mono">
            HUNTARA {release.version}
          </h1>

          <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl">
            {release.summary}
          </p>
        </div>

        {/* Downloads Section — Renders ONLY platforms with actual downloadable artifacts */}
        <section className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-[var(--foreground)] tracking-tight">
              Downloads
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Choose your platform distribution. Download packages run directly on your hardware with local-first storage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {release.platforms.map((plat) => (
              <div
                key={plat.id}
                className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] flex flex-col justify-between space-y-6 hover:border-[var(--border-strong)] transition-all"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-primary">
                      <PlatformIcon id={plat.id} className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                      {plat.label}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-[var(--foreground)]">
                      HUNTARA for {plat.label}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      Desktop client with local SQLite and OS keychain encryption.
                    </p>
                  </div>

                  {/* Artifacts List for this platform */}
                  <div className="space-y-3 pt-2">
                    {plat.artifacts.map((art) => (
                      <div
                        key={art.id}
                        className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] space-y-3"
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                          <span className="font-semibold text-[var(--foreground)]">
                            {art.architectureLabel}
                          </span>
                          <span>{art.artifactType} · {art.sizeFormatted}</span>
                        </div>

                        <a
                          href={art.downloadUrl}
                          className="inline-flex w-full h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          Download ({art.extension})
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <Link
                    href={`/releases/${release.version}/${plat.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    Platform details &amp; checksum <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Release Notes Section */}
        {release.notes && (
          <section className="space-y-4 border-t border-[var(--border-subtle)] pt-8">
            <h2 className="text-lg font-bold text-[var(--foreground)] font-mono">
              Release Notes
            </h2>
            <div className="text-xs text-[var(--text-secondary)] leading-relaxed bg-[var(--card)] border border-[var(--border)] p-6 rounded-xl whitespace-pre-wrap font-sans">
              {release.notes}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
