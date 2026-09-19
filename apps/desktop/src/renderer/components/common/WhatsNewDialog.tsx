import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2, ArrowRight, X, Shield, Zap, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';

interface WhatsNewDialogProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const DEFAULT_VERSION = '1.1.1-beta.2';

const RELEASE_HIGHLIGHTS = [
  {
    icon: Sparkles,
    color: 'text-primary',
    title: 'Precision CRM & Location Normalization',
    description: 'ISO-3166 standardized geographic filtering (Country -> State -> City) with automatic postal abbreviation normalization.'
  },
  {
    icon: Zap,
    color: 'text-success',
    title: 'Outreach Safety & Idempotent Ledger',
    description: 'Atomic email delivery claim locks with durable duplicate suppression, attachment validation, and lastContactedAt tracking.'
  },
  {
    icon: Shield,
    color: 'text-info',
    title: 'Hardened Gmail API Sending',
    description: 'Execute automated outreach safely via direct Google API OAuth authentication with automatic retry handling.'
  },
  {
    icon: RefreshCw,
    color: 'text-purple-500',
    title: 'Product-First Shell Experience',
    description: 'Organized tabbed settings, actionable product notifications, and automatic background update checks.'
  }
];

export function WhatsNewDialog({ isOpen: forceOpen, onClose: forceClose }: WhatsNewDialogProps) {
  const [open, setOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(DEFAULT_VERSION);
  const [liveReleaseNotes, setLiveReleaseNotes] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkVersionAndStatus() {
      let activeVer = DEFAULT_VERSION;
      try {
        if (window.ipc?.invoke) {
          const status = await window.ipc.invoke('updater:get-status' as any, undefined);
          if (status?.currentVersion) {
            activeVer = status.currentVersion;
          }
          if (status?.releaseNotes) {
            setLiveReleaseNotes(status.releaseNotes);
          }
        }
      } catch {}

      if (isMounted) {
        setCurrentVersion(activeVer);

        if (typeof forceOpen === 'boolean') {
          setOpen(forceOpen);
          return;
        }

        try {
          const lastSeen = localStorage.getItem('last_whats_new_version');
          if (lastSeen !== activeVer) {
            setOpen(true);
          }
        } catch {}
      }
    }

    checkVersionAndStatus();

    return () => {
      isMounted = false;
    };
  }, [forceOpen]);

  const handleDismiss = () => {
    try {
      localStorage.setItem('last_whats_new_version', currentVersion);
    } catch {}
    setOpen(false);
    if (forceClose) forceClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans text-xs select-none">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            className="absolute inset-0 bg-background/60 backdrop-blur-xs"
          />

          {/* Modal Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 w-full max-w-md bg-card border border-border-subtle rounded-none shadow-elevation-3 p-6 space-y-6"
          >
            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary border border-primary/20 text-[10px] font-mono font-bold px-2 py-0.5 rounded-none">
                  v{currentVersion}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider font-bold">
                  Release Highlights
                </span>
              </div>
              <h2 className="text-base font-bold text-foreground tracking-tight">
                What's New in HUNTARA
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Here is a summary of the latest capabilities and UX enhancements in your lead generation OS.
              </p>
            </div>

            {/* Content: Live release notes from GitHub when available, or curated highlights */}
            {liveReleaseNotes ? (
              <div className="p-3 bg-surface-3/40 border border-border-subtle/60 rounded-none max-h-64 overflow-y-auto space-y-2 text-foreground font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
                {liveReleaseNotes}
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                {RELEASE_HIGHLIGHTS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3 bg-surface-3/40 border border-border-subtle/60 rounded-none"
                    >
                      <div className={`mt-0.5 shrink-0 ${item.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="space-y-0.5">
                        <h4 className="font-semibold text-foreground text-xs">{item.title}</h4>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            <div className="pt-2 flex items-center justify-between border-t border-border-subtle/50">
              <span className="text-[10px] text-muted-foreground font-mono">
                HUNTARA Baseline
              </span>
              <Button
                onClick={handleDismiss}
                size="sm"
                className="gap-1.5 rounded-none font-semibold text-xs h-8 px-4"
              >
                <span>Got it, thanks!</span>
                <CheckCircle2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
