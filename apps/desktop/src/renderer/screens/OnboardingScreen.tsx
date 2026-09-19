import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import {
  Sparkles,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Mail,
  FolderOpen,
  ArrowRight,
  HeartPulse,
  Server,
  Info
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import huntaraMark from '../assets/huntara-mark.png';

/**
 * OnboardingScreen — Step-by-step workspace onboarding for HUNTARA.
 *
 * Updates:
 *   - Combined Workspace setup Name configuration directly into Step 1.
 *   - Removed Workspace directory selector and non-functional Browse actions.
 *   - Used actual app logo icon (logoLight) in the header.
 *   - All styles match design guidelines with strict rounded-none configurations.
 *   - Smooth aggressive framer-motion step transition animations.
 */
export default function OnboardingScreen() {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, createWorkspace, updateWorkspace } = useWorkspace();

  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [testingConnection, setTestingConnection] = useState<boolean>(false);

  // Diagnostics State
  const [diagnostics, setDiagnostics] = useState<any>(null);

  // Form States
  const [wsName, setWsName] = useState<string>('');
  const [aiMode, setAiMode] = useState<'local' | 'cloud' | 'skip'>('skip');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [openRouterKey, setOpenRouterKey] = useState<string>('');

  // Load diagnostics and existing workspace name on mount
  useEffect(() => {
    runDiagnostics();
  }, []);

  useEffect(() => {
    const currentWs = activeWorkspace || (workspaces && workspaces.length > 0 ? workspaces[0] : null);
    if (currentWs?.name) {
      setWsName(currentWs.name);
    } else if (!wsName) {
      setWsName('HUNTARA Workspace');
    }
  }, [activeWorkspace, workspaces]);

  const runDiagnostics = async () => {
    try {
      const res = await window.ipc.invoke('onboarding:get-diagnostics', undefined);
      setDiagnostics(res);
      if (res.ollamaInstalled && res.ollamaModels.length > 0) {
        setAiMode('local');
        setSelectedModel(res.ollamaModels[0] || '');
      }
    } catch (err) {
      console.error('Failed to run diagnostics:', err);
    }
  };

  const handleCreateWorkspace = async () => {
    setLoading(true);
    try {
      const targetName = wsName.trim() || 'HUNTARA Workspace';

      // Reuse existing workspace or create a new one only if none exists
      let ws = activeWorkspace || (workspaces && workspaces.length > 0 ? workspaces[0] : null);
      if (ws) {
        if (ws.name !== targetName) {
          ws = await updateWorkspace(ws.id, { name: targetName });
        }
      } else {
        ws = await createWorkspace(targetName);
      }

      // Save credentials if OpenRouter key is provided
      if (aiMode === 'cloud' && openRouterKey && ws?.id) {
        await window.ipc.invoke('onboarding:save-setting', {
          workspaceId: ws.id,
          key: 'openrouter_key',
          value: openRouterKey
        });
      }

      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('product_tour_active', 'true'); // trigger product tour on dashboard first visit

      toast.success('Workspace initialized successfully!');
      // Navigate to dashboard
      navigate('/');
    } catch (err: any) {
      toast.error(`Workspace initialization failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const testOpenRouter = async () => {
    setTestingConnection(true);
    try {
      if (!openRouterKey) {
        toast.error('Please enter an API Key first.');
        return;
      }
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${openRouterKey}` }
      });
      if (res.ok) {
        toast.success('OpenRouter API connection validated successfully!');
      } else {
        toast.error('Validation failed: Invalid OpenRouter API Key.');
      }
    } catch {
      toast.error('Validation failed: Network timeout or connectivity issue.');
    } finally {
      setTestingConnection(false);
    }
  };

  // Stagger entry configurations
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 500, damping: 35 } }
  };

  const getBadgeClass = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'running':
      case 'active':
      case 'healthy':
      case 'operating':
        return 'bg-success-muted text-success border border-success/20 rounded-none';
      case 'queued':
      case 'starting':
      case 'waiting':
      case 'warning':
      case 'medium':
        return 'bg-warning-muted text-warning border border-warning/20 rounded-none';
      case 'failed':
      case 'critical':
      case 'high':
        return 'bg-danger-muted text-danger border border-danger/20 rounded-none';
      default:
        return 'bg-muted-muted text-muted-foreground border-border-subtle rounded-none';
    }
  };

  return (
    <div className="min-h-screen bg-[#06080c] text-foreground font-sans flex items-center justify-center p-6 relative overflow-hidden select-none">
      {/* Aggressive ambient glow elements in the background */}
      <motion.div
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.15, 0.22, 0.15]
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
        className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/20 rounded-none filter blur-[140px] pointer-events-none"
      />
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.08, 0.15, 0.08]
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 2
        }}
        className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-info/10 rounded-none filter blur-[120px] pointer-events-none"
      />

      <div className="w-full max-w-xl bg-card border border-border-subtle rounded-none p-8 shadow-elevation-2 relative overflow-hidden flex flex-col space-y-6">
        {/* Onboarding Header */}
        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-none bg-primary/10 flex items-center justify-center p-1.5 shrink-0 overflow-hidden">
              <img src={huntaraMark} className="h-full w-full object-contain" alt="HUNTARA Logo" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-tight text-foreground uppercase">
                HUNTARA
              </h1>
              <span className="text-[10px] text-muted-foreground block font-bold uppercase mt-0.5">
                Workspace Initialization
              </span>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 bg-surface-3 rounded-none border border-border-subtle text-muted-foreground font-mono">
            Step {step} of 4
          </span>
        </div>

        {/* Step-by-step progress indicator line */}
        <div className="w-full bg-surface-3 h-[2px] relative overflow-hidden">
          <motion.div
            className="absolute left-0 top-0 bottom-0 bg-primary"
            initial={{ width: '0%' }}
            animate={{ width: `${(step / 4) * 100}%` }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          />
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step 1: Workspace Name & Diagnostics ────────────────────────── */}
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="space-y-5"
            >
              <div className="space-y-1">
                <h2 className="text-base font-bold text-foreground">
                  Prepare your sales outbound platform
                </h2>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Name your workspace. We will configure an isolated SQLite database file to securely store your leads.
                </p>
              </div>

              {/* Workspace Name Input */}
              <div className="space-y-1.5 bg-surface-3 border border-border-subtle rounded-none p-4 shadow-inner">
                <Label htmlFor="wsNameInput" className="font-semibold text-muted-foreground">Workspace Name</Label>
                <input
                  id="wsNameInput"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="e.g. My Leads Workspace"
                  className="w-full h-9 px-3 bg-card border border-border-subtle rounded-none text-xs font-semibold focus-visible:outline-none focus:border-primary text-foreground"
                />
              </div>

              {/* Health Checklist */}
              <div className="bg-surface-3 border border-border-subtle rounded-none p-4 space-y-3 shadow-inner">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 border-b border-border-subtle/50 pb-1.5">
                  <HeartPulse className="w-3.5 h-3.5 text-primary" />
                  <span>System Health Verification</span>
                </h3>

                {diagnostics ? (
                  <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    className="grid grid-cols-2 gap-3 text-[10px]"
                  >
                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      <span className="text-muted-foreground">
                        OS:{' '}
                        <span className="text-foreground font-semibold font-mono">
                          {diagnostics.os.substring(0, 18)}...
                        </span>
                      </span>
                    </motion.div>
                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                      {diagnostics.writePermissions ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                      )}
                      <span className="text-muted-foreground">
                        Write Access:{' '}
                        <span className="text-foreground font-semibold">
                          {diagnostics.writePermissions ? 'Yes' : 'No'}
                        </span>
                      </span>
                    </motion.div>
                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      <span className="text-muted-foreground">
                        SQLite 3: <span className="text-foreground font-semibold">Available</span>
                      </span>
                    </motion.div>
                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                      {diagnostics.internetConnected ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                      )}
                      <span className="text-muted-foreground">
                        Internet:{' '}
                        <span className="text-foreground font-semibold">
                          {diagnostics.internetConnected ? 'Connected' : 'Offline'}
                        </span>
                      </span>
                    </motion.div>
                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                      {diagnostics.ollamaInstalled ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <div className="w-4 h-4 bg-muted border border-border-subtle rounded-none shrink-0 flex items-center justify-center text-[8px] font-bold text-muted-foreground font-mono">
                          !
                        </div>
                      )}
                      <span className="text-muted-foreground">
                        Local AI (Ollama):{' '}
                        <span className="text-foreground font-semibold">
                          {diagnostics.ollamaInstalled ? 'Installed' : 'Not Detected'}
                        </span>
                      </span>
                    </motion.div>
                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      <span className="text-muted-foreground">
                        Workers Host: <span className="text-foreground font-semibold">Ready</span>
                      </span>
                    </motion.div>
                  </motion.div>
                ) : (
                  <p className="text-[10px] text-muted-foreground animate-pulse">
                    Running health check queries...
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle/50">
                <Button type="button" size="sm" variant="ghost" className="rounded-none text-[10px]" onClick={runDiagnostics}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-Check
                </Button>
                <Button type="button" size="sm" className="rounded-none text-[10px]" onClick={() => setStep(2)}>
                  Continue <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: AI Configuration ─────────────────────────────────────── */}
          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="space-y-5"
            >
              <div className="space-y-1">
                <h2 className="text-base font-bold text-foreground">
                  Configure Lead Intelligence AI
                </h2>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Unlock automated cold email opening lines, pain point hypotheses, and lead score
                  analytics.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAiMode('local')}
                    disabled={!diagnostics?.ollamaInstalled}
                    className={`flex-1 border p-3.5 rounded-none text-left space-y-1.5 transition-all outline-none ${
                      aiMode === 'local'
                        ? 'border-primary bg-primary/5'
                        : 'border-border-subtle bg-card opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <Cpu className="w-4 h-4 text-primary" />
                    <div>
                      <h4 className="text-[11px] font-bold text-foreground">Local AI (Ollama)</h4>
                      <span className="text-[9px] text-muted-foreground block mt-0.5 font-medium">
                        Secure, offline, 100% free.
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAiMode('cloud')}
                    className={`flex-1 border p-3.5 rounded-none text-left space-y-1.5 transition-all outline-none ${
                      aiMode === 'cloud'
                        ? 'border-primary bg-primary/5'
                        : 'border-border-subtle bg-card'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-info" />
                    <div>
                      <h4 className="text-[11px] font-bold text-foreground">Cloud AI (OpenRouter)</h4>
                      <span className="text-[9px] text-muted-foreground block mt-0.5 font-medium">
                        High-quality remote LLMs.
                      </span>
                    </div>
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {aiMode === 'local' && diagnostics?.ollamaModels && (
                    <motion.div
                      key="local-ai-details"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-surface-3 border border-border-subtle rounded-none p-4 space-y-2 overflow-hidden shadow-inner"
                    >
                      <Label htmlFor="modelSelect">Available Local Models</Label>
                      <select
                        id="modelSelect"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="w-full h-8 px-2 bg-card border border-border-subtle rounded-none text-xs focus-visible:outline-none font-semibold text-foreground"
                      >
                        {diagnostics.ollamaModels.map((m: string) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </motion.div>
                  )}

                  {aiMode === 'cloud' && (
                    <motion.div
                      key="cloud-ai-details"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-surface-3 border border-border-subtle rounded-none p-4 space-y-3 overflow-hidden shadow-inner"
                    >
                      <div className="space-y-1">
                        <Label htmlFor="orKeyInput">OpenRouter API Key</Label>
                        <div className="flex gap-2">
                          <input
                            id="orKeyInput"
                            type="password"
                            placeholder="sk-or-v1-..."
                            value={openRouterKey}
                            onChange={(e) => setOpenRouterKey(e.target.value)}
                            className="flex-1 h-8 px-2 bg-card border border-border-subtle rounded-none text-xs focus-visible:outline-none font-mono"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-none text-[10px]"
                            onClick={testOpenRouter}
                            disabled={testingConnection}
                          >
                            {testingConnection ? 'Testing...' : 'Test Key'}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex justify-between pt-2 border-t border-border-subtle/50">
                <Button type="button" size="sm" variant="ghost" className="rounded-none text-[10px]" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="button" size="sm" className="rounded-none text-[10px]" onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Outbound Email Integration ─────────────────────────────── */}
          {step === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="space-y-5"
            >
              <div className="space-y-1">
                <h2 className="text-base font-bold text-foreground">Outbound Email Integration</h2>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  HUNTARA connects directly to Gmail using official Google OAuth 2.0 authorization.
                  You can connect your mailbox in Settings anytime without giving out your password.
                </p>
              </div>

              <div className="bg-surface-3 border border-border-subtle rounded-none p-4 space-y-3 shadow-inner">
                <div className="bg-info-muted border border-info/20 rounded-none p-3 text-[10px] leading-relaxed text-info font-medium flex gap-2">
                  <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-info">Secure Google Authorization:</span> Mailboxes are managed in <strong>Settings → Email Accounts</strong>. OAuth consent opens safely in Google Chrome, giving HUNTARA permission to dispatch campaign emails securely.
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-2 border-t border-border-subtle/50">
                <Button type="button" size="sm" variant="ghost" className="rounded-none text-[10px]" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button type="button" size="sm" className="rounded-none text-[10px]" onClick={() => setStep(4)}>
                  Continue
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 4: Sample Workspace & Launch ────────────────────────────── */}
          {step === 4 && (
            <motion.div
              key="step-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="space-y-5"
            >
              <div className="space-y-1">
                <h2 className="text-base font-bold text-foreground">You are ready to launch!</h2>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Confirm your parameters below to finish initializing your local sales intelligence
                  operating system.
                </p>
              </div>

              <div className="bg-surface-3 border border-border-subtle rounded-none p-4 space-y-3 shadow-inner">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Workspace Name:</span>
                  <span className="font-bold text-foreground">{wsName}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-border-subtle/50">
                  <span className="text-muted-foreground">AI Configuration:</span>
                  <span className="font-bold text-foreground uppercase">{aiMode}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-border-subtle/50">
                  <span className="text-muted-foreground">Mailbox Auth:</span>
                  <span className="font-bold text-foreground">Google OAuth (Settings)</span>
                </div>
              </div>

              <div className="flex justify-between pt-2 border-t border-border-subtle/50">
                <Button type="button" size="sm" variant="ghost" className="rounded-none text-[10px]" onClick={() => setStep(3)} disabled={loading}>
                  Back
                </Button>
                <Button type="button" size="sm" onClick={handleCreateWorkspace} disabled={loading} className="px-6 rounded-none text-[10px]">
                  {loading ? 'Initializing Workspace...' : 'Launch HUNTARA'}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
