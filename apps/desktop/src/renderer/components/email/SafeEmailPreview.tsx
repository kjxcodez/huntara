import React, { useState, useEffect, useRef, useMemo } from 'react';
import { sanitizeHtmlForPreview } from '@huntara/schema';
import { ShieldCheck, Image as ImageIcon, FileText, Code2, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

export interface SafeEmailPreviewProps {
  htmlBody?: string | null;
  textBody?: string | null;
  subject?: string;
  className?: string;
}

export const SafeEmailPreview: React.FC<SafeEmailPreviewProps> = ({
  htmlBody,
  textBody,
  subject,
  className = ''
}) => {
  const [blockRemoteImages, setBlockRemoteImages] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'html' | 'text'>(htmlBody ? 'html' : 'text');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const hasHtml = !!htmlBody && htmlBody.trim().length > 0;
  const hasText = !!textBody && textBody.trim().length > 0;

  // Sanitize the HTML safely with tracking pixels removed and optional remote images blocked
  const sanitizedHtml = useMemo(() => {
    if (!hasHtml) return '';
    return sanitizeHtmlForPreview(htmlBody || '', {
      stripTrackingPixels: true,
      blockRemoteImages,
      neutralizeLinks: true
    });
  }, [htmlBody, blockRemoteImages, hasHtml]);

  // Adjust iframe content and height
  useEffect(() => {
    if (activeTab !== 'html' || !iframeRef.current || !hasHtml) return;

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    // Reset doc content with clean styling and isolated dark theme compatibility
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <base target="_blank" />
          <style>
            :root {
              color-scheme: dark light;
            }
            body {
              margin: 0;
              padding: 16px;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: #f1f5f9;
              background-color: transparent;
              word-break: break-word;
              overflow-x: hidden;
            }
            a {
              color: #38bdf8;
              text-decoration: underline;
              cursor: pointer;
            }
            a:hover {
              color: #7dd3fc;
            }
            img {
              max-width: 100%;
              height: auto;
              border-radius: 4px;
            }
            blockquote {
              margin: 12px 0;
              padding-left: 12px;
              border-left: 3px solid #475569;
              color: #94a3b8;
            }
            pre, code {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 13px;
              background: #1e293b;
              border-radius: 4px;
              padding: 2px 4px;
            }
            table {
              max-width: 100%;
              border-collapse: collapse;
            }
          </style>
        </head>
        <body>
          ${sanitizedHtml}
        </body>
      </html>
    `);
    doc.close();

    // Intercept all link clicks in iframe to open in default browser via IPC
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a');
      if (target && target.href) {
        e.preventDefault();
        if (typeof (window as any).ipc?.invoke === 'function') {
          (window as any).ipc.invoke('electron:openUrl', target.href);
        } else {
          window.open(target.href, '_blank', 'noopener,noreferrer');
        }
      }
    };
    doc.addEventListener('click', handleClick);

    // Auto-adjust height to prevent internal scrollbars
    const resizeObserver = new ResizeObserver(() => {
      if (iframe && doc.body) {
        const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 80);
        iframe.style.height = `${height + 24}px`;
      }
    });

    if (doc.body) {
      resizeObserver.observe(doc.body);
    }

    return () => {
      doc.removeEventListener('click', handleClick);
      resizeObserver.disconnect();
    };
  }, [sanitizedHtml, activeTab, hasHtml]);

  return (
    <div className={`flex flex-col border border-border/80 rounded-lg overflow-hidden bg-card/50 min-w-0 ${className}`}>
      {/* Header Controls Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30 text-xs">
        <div className="flex items-center gap-2">
          {hasHtml && hasText && (
            <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'html' | 'text')}>
              <TabsList className="h-7 bg-muted/80 p-0.5">
                <TabsTrigger value="html" className="h-6 px-2.5 text-xs flex items-center gap-1">
                  <Code2 className="w-3 h-3" />
                  HTML
                </TabsTrigger>
                <TabsTrigger value="text" className="h-6 px-2.5 text-xs flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Plain Text
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {!hasHtml && hasText && (
            <span className="flex items-center gap-1 font-medium text-muted-foreground">
              <FileText className="w-3.5 h-3.5" />
              Plain Text View
            </span>
          )}

          {hasHtml && !hasText && (
            <span className="flex items-center gap-1 font-medium text-muted-foreground">
              <Code2 className="w-3.5 h-3.5" />
              HTML Preview
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasHtml && activeTab === 'html' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setBlockRemoteImages((prev) => !prev)}
              title={blockRemoteImages ? 'Allow remote images to load' : 'Block remote images for privacy'}
            >
              <ImageIcon className="w-3 h-3 mr-1" />
              {blockRemoteImages ? 'Load Images' : 'Block Images'}
            </Button>
          )}

          <span
            className="flex items-center gap-1 text-[11px] text-muted-foreground/80"
            title="Safe sandboxed rendering. Tracking pixels stripped. External links open in default browser."
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Isolated Sandbox
          </span>
        </div>
      </div>

      {/* Blocked Remote Images Alert Banner */}
      {hasHtml && activeTab === 'html' && blockRemoteImages && (
        <div className="flex items-center justify-between px-3 py-1 bg-amber-500/5 border-b border-amber-500/15 text-[10.5px] text-amber-300/85">
          <span className="truncate">Remote images are blocked to protect privacy (tracking pixels stripped).</span>
          <button
            onClick={() => setBlockRemoteImages(false)}
            className="underline hover:text-amber-200 font-medium ml-2 shrink-0 cursor-pointer text-[10.5px]"
          >
            Load remote images
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="relative min-h-[140px] bg-background/50 min-w-0 max-w-full overflow-hidden">
        {activeTab === 'html' && hasHtml ? (
          <iframe
            ref={iframeRef}
            title={subject || 'Email Preview'}
            sandbox="allow-same-origin"
            className="w-full max-w-full min-w-0 border-none block"
            style={{ minHeight: '140px' }}
          />
        ) : (
          <div className="p-4 text-sm font-mono whitespace-pre-wrap break-words min-w-0 text-foreground/90 leading-relaxed select-text">
            {textBody || '(No message body content)'}
          </div>
        )}
      </div>
    </div>
  );
};
