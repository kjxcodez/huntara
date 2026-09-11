import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../../hooks/useWorkspace';
import {
  Bell,
  X,
  PlusCircle,
  CheckCircle,
  Info,
  Trash,
  MessageSquare,
  AlertTriangle,
  Mail,
  Zap,
  Sparkles,
  RefreshCw,
  ArrowRight
} from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface ProductNotification {
  id: string;
  type:
    | 'discovery_completed'
    | 'discovery_failed'
    | 'campaign_completed'
    | 'campaign_failed'
    | 'gmail_attention_required'
    | 'update_available'
    | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionRoute?: string;
}

const EVENT_ICONS: Record<string, any> = {
  discovery_completed: Sparkles,
  discovery_failed: AlertTriangle,
  campaign_completed: CheckCircle,
  campaign_failed: AlertTriangle,
  gmail_attention_required: Mail,
  update_available: RefreshCw,
  system: Info
};

const EVENT_COLORS: Record<string, string> = {
  discovery_completed: 'text-success',
  discovery_failed: 'text-danger',
  campaign_completed: 'text-success',
  campaign_failed: 'text-danger',
  gmail_attention_required: 'text-warning',
  update_available: 'text-primary',
  system: 'text-info'
};

/**
 * NotificationCenter — product-level Notification drawer.
 * Displays user-facing events ("What happened / What needs attention")
 * instead of raw system/database logs.
 */
export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const navigate = useNavigate();

  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('product_notifications_read');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Query product notifications derived from active workspace runs, campaigns, email status, & updater
  const notificationsQuery = useQuery({
    queryKey: ['product-notifications', workspaceId],
    queryFn: async (): Promise<ProductNotification[]> => {
      const items: ProductNotification[] = [];

      try {
        // 1. Discovery runs
        const runs = await window.ipc.invoke('discovery:run:list', { workspaceId });
        if (Array.isArray(runs)) {
          for (const r of runs.slice(0, 10)) {
            if (r.status === 'completed') {
              items.push({
                id: `disc_${r.id}`,
                type: 'discovery_completed',
                title: 'Discovery Completed',
                message: `Found ${r.processedCount || r.resultsCount || 0} leads for "${r.query || 'Search'}".`,
                timestamp: r.updatedAt || r.createdAt,
                read: false,
                actionRoute: '/companies'
              });
            } else if (r.status === 'failed') {
              items.push({
                id: `disc_${r.id}`,
                type: 'discovery_failed',
                title: 'Discovery Failed',
                message: `Lead discovery for "${r.query || 'Search'}" encountered an error.`,
                timestamp: r.updatedAt || r.createdAt,
                read: false,
                actionRoute: '/discovery'
              });
            }
          }
        }
      } catch {}

      try {
        // 2. Campaigns
        const campaigns = await window.ipc.invoke('campaigns:list' as any, { workspaceId });
        if (Array.isArray(campaigns)) {
          for (const c of campaigns.slice(0, 10)) {
            if (c.status === 'completed') {
              items.push({
                id: `camp_${c.id}`,
                type: 'campaign_completed',
                title: 'Campaign Completed',
                message: `Outreach campaign "${c.name}" completed successfully.`,
                timestamp: c.updatedAt || c.createdAt,
                read: false,
                actionRoute: '/campaigns'
              });
            }
          }
        }
      } catch {}

      try {
        // 3. Email Accounts (Gmail health)
        const accounts = await window.ipc.invoke('email-accounts:list' as any, undefined);
        if (Array.isArray(accounts)) {
          for (const acc of accounts) {
            if (acc.status === 'reauth_required') {
              items.push({
                id: `gmail_${acc.id}`,
                type: 'gmail_attention_required',
                title: 'Gmail Needs Attention',
                message: `Connection for ${acc.email} needs to be refreshed.`,
                timestamp: acc.updatedAt || new Date().toISOString(),
                read: false,
                actionRoute: '/settings?section=integrations'
              });
            }
          }
        }
      } catch {}

      try {
        // 4. Application updates
        const updaterStatus = await window.ipc.invoke('updater:get-status' as any, undefined);
        if (updaterStatus?.status === 'available' || updaterStatus?.updateAvailable) {
          items.push({
            id: `upd_${updaterStatus.availableVersion || 'latest'}`,
            type: 'update_available',
            title: 'Update Available',
            message: `LeadForge OS v${updaterStatus.availableVersion || '1.0.1'} is ready to install.`,
            timestamp: new Date().toISOString(),
            read: false,
            actionRoute: '/settings?section=updates'
          });
        }
      } catch {}

      // Sort descending by timestamp
      return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },
    enabled: !!workspaceId && isOpen,
    refetchInterval: isOpen ? 10000 : false
  });

  const notifications = (notificationsQuery.data || []).map((item) => ({
    ...item,
    read: readIds.has(item.id)
  }));

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev).add(id);
      localStorage.setItem('product_notifications_read', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const markAllAsRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      localStorage.setItem('product_notifications_read', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleAction = (item: ProductNotification) => {
    markAsRead(item.id);
    if (item.actionRoute) {
      navigate(item.actionRoute);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end font-sans text-xs">
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-background/40 backdrop-blur-xs"
          />

          {/* Slide-out Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="relative z-10 w-80 h-full bg-card border-l border-border-subtle shadow-elevation-2 flex flex-col justify-between"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-border-subtle flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-primary" />
                <h3 className="font-bold text-foreground uppercase tracking-wider text-[10px]">
                  Notifications
                </h3>
                {unreadCount > 0 && (
                  <span className="bg-primary text-primary-foreground font-mono text-[9px] font-bold px-1.5 py-0.2 rounded-none">
                    {unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-[10px] text-muted-foreground hover:text-primary transition-colors cursor-pointer font-semibold"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {notificationsQuery.isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2 border-b border-border-subtle/50 pb-3">
                      <Skeleton className="h-3 w-2/3 rounded-none" />
                      <Skeleton className="h-2 w-1/2 rounded-none" />
                    </div>
                  ))}
                </div>
              ) : notifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-4">
                  <Bell className="w-8 h-8 opacity-30 mb-2" />
                  <p className="font-semibold text-foreground">No new notifications</p>
                  <p className="text-[10px] opacity-75 mt-1 max-w-[180px] leading-relaxed">
                    Important events regarding lead discovery, outreach, and system health will display here.
                  </p>
                </div>
              ) : (
                <motion.div
                  className="space-y-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
                >
                  {notifications.map((item) => {
                    const Icon = EVENT_ICONS[item.type] || Info;
                    const colorClass = EVENT_COLORS[item.type] || 'text-muted-foreground';

                    return (
                      <motion.div
                        key={item.id}
                        variants={{
                          hidden: { opacity: 0, x: 12 },
                          visible: { opacity: 1, x: 0, transition: { duration: 0.16, ease: 'easeOut' } }
                        }}
                        onClick={() => handleAction(item)}
                        className={`flex gap-3 p-3 border border-border-subtle rounded-none cursor-pointer transition-all ${
                          item.read
                            ? 'bg-surface-3/30 opacity-75 hover:opacity-100'
                            : 'bg-surface-3/70 border-primary/30 shadow-xs'
                        }`}
                      >
                        <div className={`mt-0.5 shrink-0 ${colorClass}`}>
                          <Icon className="w-4 h-4" />
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-foreground text-xs leading-tight">
                              {item.title}
                            </span>
                            {!item.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            )}
                          </div>

                          <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
                            {item.message}
                          </p>

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[9px] text-muted-foreground font-mono">
                              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>

                            {item.actionRoute && (
                              <span className="text-[10px] text-primary font-semibold flex items-center gap-0.5 group-hover:underline">
                                View <ArrowRight className="w-2.5 h-2.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}
            </div>

            {/* Help & Diagnostics Link footer */}
            <div className="border-t border-border-subtle bg-surface-3/30 px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground select-none shrink-0">
              <span className="font-mono">{notifications.length} events</span>
              <button
                onClick={() => {
                  onClose();
                  navigate('/operations');
                }}
                className="hover:text-primary transition-colors cursor-pointer font-semibold underline"
              >
                View Technical Logs
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

