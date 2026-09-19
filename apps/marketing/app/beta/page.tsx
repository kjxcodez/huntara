"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { CheckCircle2, Sparkles, Send, Loader2 } from "lucide-react"

export default function BetaPage() {
  const [email, setEmail] = useState("")
  const [platform, setPlatform] = useState("win")
  const [motivation, setMotivation] = useState("")
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    let apiHost = "https://api.leadforge.kapiljangid.pro"
    if (typeof window !== "undefined") {
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        apiHost = "http://localhost:3001"
      }
    }
    apiHost = process.env.NEXT_PUBLIC_API_URL || apiHost
    const apiUrl = `${apiHost}/api/v1/beta-apply`

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, platform, motivation })
      })
      
      const contentType = response.headers.get("content-type")
      if (contentType && contentType.includes("application/json")) {
        const data = await response.json()
        if (data.success) {
          setSubmitted(true)
        } else {
          console.error("Failed to submit beta application:", data.error)
          setError(data.error || "Failed to submit application. Please try again.")
        }
      } else {
        const text = await response.text()
        console.error("Non-JSON response received:", text)
        setError(`Error (${response.status}): ${text || "Unable to submit application"}`)
      }
    } catch (err) {
      console.error("Network error during beta application:", err)
      setError("Network error: Please check your internet connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-6 py-20 min-h-[85vh] text-left">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-xl mx-auto space-y-12"
      >
        {/* Header Block */}
        <div className="space-y-4">
          <motion.div variants={childVariants} className="text-[10px] font-mono uppercase tracking-wider text-[var(--primary)] font-semibold">
            Beta Program
          </motion.div>
          <motion.h1 variants={childVariants} className="text-3xl font-semibold tracking-tight text-[var(--foreground)] md:text-4xl">
            Join the Beta
          </motion.h1>
          <motion.p variants={childVariants} className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Test the latest pre-release versions of HUNTARA. Help us find edge cases in SMTP handshakes and WAL checkpoints.
          </motion.p>
        </div>

        {/* Form Container */}
        <motion.div variants={childVariants} className="border border-[var(--border)] rounded-lg p-6 bg-[var(--card)]">
          <AnimatePresence mode="wait">
            {!submitted ? (
              <motion.form 
                key="form"
                onSubmit={handleSubmit}
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Email Address</label>
                  <input 
                    type="email" 
                    required 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@company.com"
                    className="w-full h-9 px-3 rounded bg-[var(--background)] border border-[var(--border-subtle)] text-xs text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none transition-all"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Primary OS / Environment</label>
                  <select 
                    required
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full h-9 px-3 rounded bg-[var(--background)] border border-[var(--border-subtle)] text-xs text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none transition-all"
                  >
                    <option value="win">Windows 10 / 11 (x64)</option>
                    <option value="mac-arm">macOS (Apple Silicon M1/M2/M3)</option>
                    <option value="mac-intel">macOS (Intel)</option>
                    <option value="linux">Linux (Debian / Fedora / AppImage)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Why do you want to join the beta?</label>
                  <textarea 
                    required
                    value={motivation}
                    onChange={(e) => setMotivation(e.target.value)}
                    placeholder="Tell us about your outbound use case and volume needs..."
                    className="w-full h-24 p-3 rounded bg-[var(--background)] border border-[var(--border-subtle)] text-xs text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none transition-all resize-none"
                  />
                </div>

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full h-9 rounded bg-[var(--primary)] text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Submitting Application...
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Apply for Beta Access
                    </>
                  )}
                </button>

                {error && (
                  <p className="text-[11px] text-red-500 text-center font-medium mt-2">
                    {error}
                  </p>
                )}
              </motion.form>
            ) : (
              <motion.div 
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4 text-center py-6"
              >
                <CheckCircle2 className="h-10 w-10 text-[var(--success)] mx-auto animate-bounce" />
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-[var(--foreground)]">Application Received</h2>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed max-w-xs mx-auto">
                    Thanks for applying! We have successfully registered your application (for platform: <span className="font-mono text-white">{platform}</span>). We will notify you via email (<span className="text-white">{email}</span>) as soon as new slots open.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

      </motion.div>
    </div>
  )
}
