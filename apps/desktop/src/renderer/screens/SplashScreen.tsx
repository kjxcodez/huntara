import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import huntaraMark from '../assets/huntara-mark.png';

interface BootStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'completed';
}

const INITIAL_STEPS: BootStep[] = [
  { id: 'session',              label: 'Restoring user session',         status: 'loading' },
  { id: 'database:open',        label: 'Opening workspace database',     status: 'pending' },
  { id: 'database:migrations',  label: 'Applying database migrations',   status: 'pending' },
  { id: 'scheduler:start',      label: 'Starting job scheduler',         status: 'pending' },
  { id: 'sync:start',           label: 'Starting cloud sync engine',     status: 'pending' },
  { id: 'automation:start',     label: 'Starting automation runtime',    status: 'pending' }
];

/**
 * SplashScreen — Displays Bootloader Progress during application launch.
 *
 * Design Inspirations:
 *   - Premium dark background with slow-pulsing circular ambient glows.
 *   - Squared card container (rounded-none) with decorative dot matrices in corners.
 *   - Centered app logo with soft primary glow.
 *   - Digna-style segmented loading progress bar indicator.
 *   - Dynamic version retrieval via electron IPC.
 */
export function SplashScreen() {
  const [steps, setSteps] = useState<BootStep[]>(INITIAL_STEPS);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [appVersion, setAppVersion] = useState('1.0.0');

  // Load app version on mount
  useEffect(() => {
    window.ipc.invoke('electron:version' as any, undefined)
      .then((v: string) => setAppVersion(v))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleProgress = (data: any) => {
      setSteps((prev) => {
        return prev.map((s) => {
          if (s.id === 'session') return { ...s, status: 'completed' };
          if (s.id === data.step) return { ...s, status: 'loading' };
          const targetIndex  = prev.findIndex((item) => item.id === data.step);
          const currentIndex = prev.findIndex((item) => item.id === s.id);
          if (currentIndex !== -1 && targetIndex !== -1 && currentIndex < targetIndex) {
            return { ...s, status: 'completed' };
          }
          return s;
        });
      });

      if (data.step === 'ready') {
        setSteps((prev) => prev.map((s) => ({ ...s, status: 'completed' })));
        setIsFadingOut(true);
      }
    };

    const unsubscribe = window.ipc.on('workspace:boot-progress' as any, handleProgress);
    return () => {
      try { unsubscribe(); } catch { /* ignore */ }
    };
  }, []);

  // Calculate segment progress
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const currentStep = steps.find((s) => s.status === 'loading') || steps.find((s) => s.status === 'pending');
  const activeStatusLabel = currentStep ? currentStep.label : 'Finalizing workspace initialization...';

  // Segment count: 12 segments
  const totalSegments = 12;
  const filledSegments = Math.round((completedCount / steps.length) * totalSegments);

  return (
    <div className="fixed inset-0 h-screen w-screen bg-[#05070a] text-foreground font-sans flex items-center justify-center p-6 select-none overflow-hidden">
      {/* Ambient background circular glows */}
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.12, 0.2, 0.12]
        }}
        transition={{
          duration: 9,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
        className="absolute top-[-25%] left-[-15%] w-[65%] h-[65%] bg-primary/25 rounded-none filter blur-[150px] pointer-events-none"
      />
      <motion.div
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.08, 0.16, 0.08]
        }}
        transition={{
          duration: 11,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 1.5
        }}
        className="absolute bottom-[-20%] right-[-15%] w-[55%] h-[55%] bg-info/15 rounded-none filter blur-[130px] pointer-events-none"
      />

      <AnimatePresence>
        {!isFadingOut && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="w-full max-w-md bg-card border border-border-subtle rounded-none p-10 shadow-elevation-3 relative overflow-hidden flex flex-col items-center justify-center text-center space-y-6"
          >
            {/* Top-left decorative dot matrix */}
            <svg
              className="absolute top-3 left-3 opacity-30 text-primary w-12 h-12"
              fill="currentColor"
              viewBox="0 0 100 100"
            >
              {[...Array(5)].map((_, r) =>
                [...Array(5)].map((_, c) => (
                  <circle key={`${r}-${c}`} cx={10 + c * 20} cy={10 + r * 20} r="3" />
                ))
              )}
            </svg>

            {/* Bottom-right decorative dot matrix */}
            <svg
              className="absolute bottom-3 right-3 opacity-30 text-info w-12 h-12"
              fill="currentColor"
              viewBox="0 0 100 100"
            >
              {[...Array(5)].map((_, r) =>
                [...Array(5)].map((_, c) => (
                  <circle key={`${r}-${c}`} cx={10 + c * 20} cy={10 + r * 20} r="3" />
                ))
              )}
            </svg>

            {/* Centered App logo with primary background glow */}
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-none scale-125" />
              <div className="w-16 h-16 rounded-none bg-primary/10 border border-primary/25 flex items-center justify-center p-2.5 relative">
                <img src={huntaraMark} className="h-full w-full object-contain" alt="HUNTARA Logo" />
              </div>
            </div>

            {/* App identity */}
            <div className="space-y-1">
              <h1 className="text-sm font-extrabold tracking-[0.25em] text-foreground uppercase">
                HUNTARA
              </h1>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                Find the companies worth selling to.
              </p>
            </div>

            {/* App Version number */}
            <div className="text-[11px] font-mono text-zinc-500">
              v. {appVersion}
            </div>

            {/* Segmented Loading Indicator (Digna inspired) */}
            <div className="space-y-3.5 w-full max-w-[240px] pt-2">
              <div className="flex justify-between items-center gap-1.5 h-2">
                {[...Array(totalSegments)].map((_, index) => {
                  const isActive = index < filledSegments;
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0.15 }}
                      animate={{
                        opacity: isActive ? 1 : 0.15,
                        backgroundColor: isActive ? 'var(--primary)' : 'var(--border-subtle)'
                      }}
                      transition={{ duration: 0.15 }}
                      className="flex-1 h-1.5 rounded-none border border-transparent"
                    />
                  );
                })}
              </div>

              {/* Loader step label status */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeStatusLabel}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="text-[10px] text-muted-foreground font-medium h-4 truncate select-none font-mono"
                >
                  {activeStatusLabel}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
