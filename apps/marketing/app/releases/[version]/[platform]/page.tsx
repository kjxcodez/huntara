import React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { 
  Monitor, 
  Apple, 
  Terminal, 
  ArrowDownToLine, 
  ChevronRight, 
  ShieldCheck, 
  Cpu, 
  HardDrive, 
  FileCheck2,
  ExternalLink 
} from "lucide-react"
import { 
  getAllReleases, 
  getReleasePlatform, 
  PlatformId 
} from "../../../../lib/generated-releases"

type Props = {
  params: Promise<{ version: string; platform: string }>
}

function PlatformIcon({ id, className }: { id: PlatformId; className?: string }) {
  if (id === "windows") return <Monitor className={className || "h-6 w-6"} />
  if (id === "macos") return <Apple className={className || "h-6 w-6"} />
  return <Terminal className={className || "h-6 w-6"} />
}

export async function generateStaticParams() {
  const params: { version: string; platform: string }[] = []
  const releases = getAllReleases()
  for (const rel of releases) {
    for (const plat of rel.platforms) {
      params.push({
        version: rel.version,
        platform: plat.id
      })
    }
  }
  return params
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version, platform: platformParam } = await params
  const match = getReleasePlatform(version, platformParam)
  if (!match) {
    return {
      title: "Platform Not Found | HUNTARA"
    }
  }

  const { release, platform } = match
  return {
    title: `HUNTARA ${release.version} for ${platform.label} | HUNTARA`,
    description: `Official HUNTARA ${release.version} download for ${platform.label}. Local-first desktop lead discovery and intelligence platform.`
  }
}

export default async function PlatformDetailPage({ params }: Props) {
  const { version, platform: platformParam } = await params
  const match = getReleasePlatform(version, platformParam)

  // Strictly enforce 404 if version or platform does not exist for this release
  if (!match) {
    notFound()
  }

  const { release, platform } = match
  const primaryArtifact = platform.artifacts[0]

  const getSystemReqs = (id: PlatformId) => {
    switch (id) {
      case "windows":
        return {
          os: "Windows 10 / Windows 11 (64-bit)",
          arch: "Intel / AMD x64 or ARM64 (emulated)",
          ram: "4 GB RAM minimum (8 GB recommended)",
          disk: "500 MB free space for application & local SQLite databases",
          verifyCmd: `Get-FileHash .\\${primaryArtifact?.name || 'HUNTARA-*.exe'} -Algorithm SHA256`
        }
      case "macos":
        return {
          os: "macOS 12.0 Monterey or later",
          arch: "Apple Silicon (M1/M2/M3/M4) or 64-bit Intel",
          ram: "4 GB RAM minimum (8 GB recommended)",
          disk: "600 MB free disk space",
          verifyCmd: `shasum -a 256 ${primaryArtifact?.name || 'HUNTARA-*.dmg'}`
        }
      case "linux":
        return {
          os: "Ubuntu 20.04+, Debian 11+, Fedora 36+ (glibc 2.31+)",
          arch: "x86_64 / x64",
          ram: "4 GB RAM minimum (8 GB recommended)",
          disk: "500 MB free disk space",
          verifyCmd: `sha256sum ${primaryArtifact?.name || 'HUNTARA-*.AppImage'}`
        }
    }
  }

  const reqs = getSystemReqs(platform.id)

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-mono text-[var(--text-tertiary)]">
          <Link href="/releases" className="hover:text-[var(--foreground)] transition-colors">
            Releases
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href={`/releases/${release.version}`} className="hover:text-[var(--foreground)] transition-colors">
            {release.version}
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-[var(--foreground)] font-semibold">{platform.label}</span>
        </nav>

        {/* Hero Banner */}
        <div className="border border-[var(--border)] rounded-2xl p-8 bg-[var(--card)] space-y-8 relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] inline-block text-primary">
                  <PlatformIcon id={platform.id} className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-primary font-bold">
                    Official Distribution
                  </span>
                  <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] font-mono">
                    HUNTARA {release.version} for {platform.label}
                  </h1>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-xl leading-relaxed">
                Official local-first desktop installer for {platform.label}. Stores data securely on your device with OS keychain credential protection.
              </p>
            </div>

            {/* Quick Metadata Box */}
            <div className="p-4 rounded-xl bg-[var(--background)] border border-[var(--border-subtle)] space-y-1.5 text-xs font-mono shrink-0">
              <div className="text-[10px] uppercase text-[var(--text-tertiary)]">Release Status</div>
              <div className="font-bold text-[var(--foreground)]">
                {release.status === "stable" ? "Stable Build" : "Active Beta"}
              </div>
              <div className="text-[11px] text-[var(--text-tertiary)]">
                {release.releasedDateFormatted}
              </div>
            </div>
          </div>

          {/* Download Action Box (Handles Single & Multiple Architecture Packages) */}
          <div className="space-y-4 pt-4 border-t border-[var(--border-subtle)]">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
              Available Architecture Builds
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {platform.artifacts.map((art) => (
                <div 
                  key={art.id}
                  className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--background)] flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[var(--foreground)] font-mono">
                        {art.architectureLabel}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[var(--text-secondary)]">
                        {art.artifactType}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] font-mono break-all">
                      {art.name}
                    </div>
                    <div className="text-[11px] text-[var(--text-tertiary)] font-mono">
                      Size: {art.sizeFormatted}
                    </div>
                  </div>

                  <a
                    href={art.downloadUrl}
                    className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm transition-opacity"
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                    Download for {platform.label} ({art.architectureLabel})
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SHA-256 Checksum Verification — EXCLUSIVELY on Platform Detail Page */}
        <section className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
            <ShieldCheck className="h-4.5 w-4.5 text-primary" />
            Binary Integrity &amp; SHA-256 Checksums
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Verify the cryptographic signature of the downloaded package before installation to ensure binary authenticity.
          </p>

          <div className="space-y-4 pt-2">
            {platform.artifacts.map((art) => (
              <div key={art.id} className="space-y-1.5">
                <div className="text-[11px] font-mono text-[var(--text-tertiary)] font-semibold">
                  {art.name} (SHA-256):
                </div>
                <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--foreground)] break-all select-all">
                  {art.checksum}
                </div>
              </div>
            ))}

            <div className="pt-2">
              <div className="text-[11px] font-mono text-[var(--text-tertiary)] mb-1">
                Verification command ({platform.label}):
              </div>
              <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border-subtle)] font-mono text-xs text-primary/90 break-all select-all">
                {reqs.verifyCmd}
              </div>
            </div>
          </div>
        </section>

        {/* System Requirements & Installation Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Requirements */}
          <section className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
              <Cpu className="h-4.5 w-4.5 text-primary" />
              System Requirements
            </div>

            <dl className="space-y-3 text-xs font-mono divide-y divide-[var(--border-subtle)]">
              <div className="pt-2 flex justify-between gap-4">
                <dt className="text-[var(--text-tertiary)]">Operating System</dt>
                <dd className="text-[var(--foreground)] text-right">{reqs.os}</dd>
              </div>
              <div className="pt-2 flex justify-between gap-4">
                <dt className="text-[var(--text-tertiary)]">Architecture</dt>
                <dd className="text-[var(--foreground)] text-right">{reqs.arch}</dd>
              </div>
              <div className="pt-2 flex justify-between gap-4">
                <dt className="text-[var(--text-tertiary)]">Memory (RAM)</dt>
                <dd className="text-[var(--foreground)] text-right">{reqs.ram}</dd>
              </div>
              <div className="pt-2 flex justify-between gap-4">
                <dt className="text-[var(--text-tertiary)]">Storage</dt>
                <dd className="text-[var(--foreground)] text-right">{reqs.disk}</dd>
              </div>
            </dl>
          </section>

          {/* Installation Steps */}
          <section className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
              <HardDrive className="h-4.5 w-4.5 text-primary" />
              Installation Instructions
            </div>

            <ol className="space-y-3 text-xs text-[var(--text-secondary)] list-decimal list-inside leading-relaxed">
              <li>Download the official executable installer for your architecture above.</li>
              <li>
                {platform.id === "windows" && "Run the setup executable. Follow the prompts to configure local installation directory."}
                {platform.id === "macos" && "Open the downloaded .dmg file and drag HUNTARA to your Applications folder."}
                {platform.id === "linux" && "Make the AppImage executable (`chmod +x HUNTARA-*.AppImage`) and launch directly."}
              </li>
              <li>Launch HUNTARA. The application will initialize your local SQLite database automatically.</li>
              <li>Optional: Configure your API keys for outbound discovery and lead qualification.</li>
            </ol>
          </section>
        </div>

        {/* Release Notes Preview */}
        {release.notes && (
          <section className="border border-[var(--border)] rounded-xl p-6 bg-[var(--card)] space-y-3">
            <h2 className="text-sm font-bold text-[var(--foreground)] font-mono">
              Release Notes ({release.version})
            </h2>
            <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed bg-[var(--background)] p-4 rounded-lg border border-[var(--border-subtle)] font-sans">
              {release.notes}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
