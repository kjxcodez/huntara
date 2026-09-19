import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Search,
  Upload,
  HardDrive,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  Check,
  RefreshCw,
  ExternalLink,
  Plus,
  Cloud,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

export interface MediaAttachmentItem {
  id: string;
  fileId?: string | null | undefined;
  filename: string;
  mimeType?: string | null | undefined;
  size: number;
  driveUrl?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
  provider?: 'google-drive' | 'local' | undefined;
  googleConnectionId?: string | null | undefined;
}

interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: MediaAttachmentItem[]) => void;
  initialSelected?: MediaAttachmentItem[];
  multiple?: boolean;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getFileIcon(mimeType?: string | null, filename?: string) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext || '')) {
    return <ImageIcon className="w-5 h-5 text-sky-400" />;
  }
  if (
    mimeType?.includes('sheet') ||
    mimeType?.includes('excel') ||
    mimeType === 'text/csv' ||
    ['xlsx', 'xls', 'csv'].includes(ext || '')
  ) {
    return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
  }
  if (
    mimeType === 'application/pdf' ||
    mimeType?.includes('word') ||
    mimeType === 'text/plain' ||
    ['pdf', 'doc', 'docx', 'txt'].includes(ext || '')
  ) {
    return <FileText className="w-5 h-5 text-orange-400" />;
  }
  return <FileIcon className="w-5 h-5 text-muted-foreground" />;
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
  initialSelected = [],
  multiple = true
}: MediaPickerDialogProps) {
  const [tab, setTab] = useState<'library' | 'drive' | 'upload'>('library');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [libraryFiles, setLibraryFiles] = useState<any[]>([]);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [selectedMap, setSelectedMap] = useState<Map<string, MediaAttachmentItem>>(new Map());
  const [uploadingFiles, setUploadingFiles] = useState<Array<{ name: string; size: number; status: 'uploading' | 'done' | 'error'; error?: string }>>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dropzoneDragging, setDropzoneDragging] = useState(false);

  // Initialize selected items from initialSelected
  useEffect(() => {
    if (open) {
      const map = new Map<string, MediaAttachmentItem>();
      initialSelected.forEach((item) => {
        const key = item.fileId || item.id;
        if (key) map.set(key, item);
      });
      setSelectedMap(map);
      fetchConnections();
      fetchLibraryFiles();
    }
  }, [open, initialSelected]);

  const driveConnections = React.useMemo(() => {
    return connections.filter(
      (c: any) =>
        c.status === 'active' &&
        (c.driveStatus === 'authorized' ||
          (Array.isArray(c.scopes) && c.scopes.some((s: string) => typeof s === 'string' && s.includes('drive'))))
    );
  }, [connections]);

  const isDriveConnected = driveConnections.length > 0;

  // Load Google Drive connections
  const fetchConnections = async () => {
    try {
      if ((window as any).ipc) {
        const list = await (window as any).ipc.invoke('drive:connections:list', undefined);
        const conns = Array.isArray(list) ? list : [];
        setConnections(conns);
        const active = conns.find(
          (c: any) =>
            c.status === 'active' &&
            (c.driveStatus === 'authorized' ||
              (Array.isArray(c.scopes) && c.scopes.some((s: string) => typeof s === 'string' && s.includes('drive'))))
        );
        if (active) {
          setSelectedConnectionId(active.id || active._id);
        } else {
          setSelectedConnectionId('');
        }
      }
    } catch (err) {
      console.error('[MediaPicker] Failed to load connections:', err);
    }
  };

  // Fetch HUNTARA Media Library (MongoDB attachments)
  const fetchLibraryFiles = async () => {
    setLoading(true);
    try {
      if ((window as any).ipc) {
        const res = await (window as any).ipc.invoke('media:list', {
          search: search.trim() || undefined,
          category: category !== 'all' ? category : undefined,
          connectionId: selectedConnectionId || undefined
        });
        setLibraryFiles(Array.isArray(res) ? res : []);
      }
    } catch (err) {
      console.error('[MediaPicker] Failed to fetch media library:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Direct Google Drive files
  const fetchDriveFiles = async () => {
    if (!selectedConnectionId) return;
    setLoading(true);
    try {
      if ((window as any).ipc) {
        const res = await (window as any).ipc.invoke('drive:files:list', {
          connectionId: selectedConnectionId,
          search: search.trim() || undefined
        });
        setDriveFiles(Array.isArray(res?.files) ? res.files.filter((f: any) => !f.isFolder) : []);
      }
    } catch (err) {
      console.error('[MediaPicker] Failed to fetch drive files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (tab === 'library') {
      fetchLibraryFiles();
    } else if (tab === 'drive') {
      fetchDriveFiles();
    }
  }, [tab, search, category, selectedConnectionId, open]);

  const toggleSelect = (item: MediaAttachmentItem) => {
    const key = item.fileId || item.id;
    if (!key) return;

    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (!multiple) {
          next.clear();
        }
        next.set(key, item);
      }
      return next;
    });
  };

  // Handle linking Google Drive live file into HUNTARA media & selecting it
  const handleSelectDriveFile = async (f: any) => {
    try {
      let attachmentItem: MediaAttachmentItem;
      if ((window as any).ipc) {
        const linked = await (window as any).ipc.invoke('media:link', {
          googleConnectionId: selectedConnectionId,
          fileId: f.id
        });
        attachmentItem = {
          id: linked.id,
          fileId: linked.fileId || f.id,
          filename: linked.filename || f.name,
          mimeType: linked.mimeType || f.mimeType,
          size: linked.size || f.size || 0,
          driveUrl: linked.driveUrl || f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          thumbnailUrl: linked.thumbnailUrl || f.thumbnailLink,
          provider: 'google-drive',
          googleConnectionId: selectedConnectionId
        };
      } else {
        attachmentItem = {
          id: f.id,
          fileId: f.id,
          filename: f.name,
          mimeType: f.mimeType,
          size: f.size || 0,
          driveUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          thumbnailUrl: f.thumbnailLink,
          provider: 'google-drive',
          googleConnectionId: selectedConnectionId
        };
      }
      toggleSelect(attachmentItem);
      toast.success(`Selected "${f.name}" from Google Drive`);
    } catch (err: any) {
      console.error('Failed to link Drive file:', err);
      toast.error(`Could not attach Drive file: ${err.message}`);
    }
  };

  // Handle Direct Upload
  const handleFileUpload = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    const newUploading = fileList.map((f) => ({
      name: f.name,
      size: f.size,
      status: 'uploading' as const
    }));
    setUploadingFiles(newUploading);

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (!f) continue;
      if (f.size > 25 * 1024 * 1024) {
        toast.error(`"${f.name}" exceeds the 25 MB Google Drive limit.`);
        setUploadingFiles((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: 'error', error: 'Exceeds 25 MB limit' } : u))
        );
        continue;
      }

      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const res = (reader.result as string).split(',')[1] || '';
            resolve(res);
          };
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        const base64 = await base64Promise;

        const uploaded = await (window as any).ipc.invoke('media:upload', {
          filename: f.name,
          mimeType: f.type || 'application/octet-stream',
          contentBase64: base64,
          googleConnectionId: selectedConnectionId || undefined
        });

        const item: MediaAttachmentItem = {
          id: uploaded.id,
          fileId: uploaded.fileId,
          filename: uploaded.filename,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
          driveUrl: uploaded.driveUrl || (uploaded.fileId ? `https://drive.google.com/file/d/${uploaded.fileId}/view` : null),
          thumbnailUrl: uploaded.thumbnailUrl,
          provider: 'google-drive',
          googleConnectionId: uploaded.googleConnectionId || selectedConnectionId
        };

        toggleSelect(item);
        setUploadingFiles((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: 'done' } : u))
        );
        toast.success(`Uploaded "${f.name}" to Google Drive`);
      } catch (err: any) {
        console.error('Upload failed:', err);
        setUploadingFiles((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: 'error', error: err.message } : u))
        );
        toast.error(`Failed to upload "${f.name}": ${err.message}`);
      }
    }

    fetchLibraryFiles();
  };

  const handleConfirm = () => {
    const items = Array.from(selectedMap.values());
    onSelect(items);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[840px] max-w-[95vw] w-full h-[85vh] max-h-[720px] min-h-[480px] flex flex-col p-0 gap-0 overflow-hidden bg-background border-border-subtle rounded-none shadow-2xl">
        {/* REGION 1: FIXED HEADER */}
        <DialogHeader className="p-4 pb-3 border-b border-border-subtle shrink-0 pr-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 bg-primary/10 text-primary shrink-0">
                <HardDrive className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold text-foreground truncate">
                  Media & Google Drive Attachments
                </DialogTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  Select uploaded workspace assets or Google Drive files to attach
                </p>
              </div>
            </div>

            {driveConnections.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <select
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                  className="bg-surface-3 border border-border-subtle text-[11px] text-foreground px-2 py-1 outline-none font-mono max-w-[200px] truncate"
                >
                  {driveConnections.map((c: any) => (
                    <option key={c.id || c._id} value={c.id || c._id}>
                      {c.email || c.googleAccountId || 'Google Drive'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* REGION 2: TABS & RESPONSIVE TOOLBAR */}
        <Tabs value={tab} onValueChange={(v: any) => setTab(v)} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-border-subtle bg-surface-3/40 shrink-0">
            <TabsList className="bg-surface-3 p-0.5 rounded-none h-8 flex-wrap">
              <TabsTrigger value="library" className="rounded-none text-xs px-2.5 py-1">
                Media Library ({libraryFiles.length})
              </TabsTrigger>
              <TabsTrigger value="drive" className="rounded-none text-xs px-2.5 py-1">
                Google Drive Live
              </TabsTrigger>
              <TabsTrigger value="upload" className="rounded-none text-xs px-2.5 py-1">
                <Upload className="w-3 h-3 mr-1" /> Upload to Drive
              </TabsTrigger>
            </TabsList>

            {tab !== 'upload' && (
              <div className="flex items-center flex-wrap gap-2 min-w-0 flex-1 sm:flex-initial justify-end">
                {tab === 'library' && (
                  <div className="flex items-center gap-1 shrink-0">
                    {['all', 'document', 'image', 'spreadsheet'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`text-[10px] px-2 py-0.5 font-medium border transition-colors ${
                          category === cat
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-foreground'
                        }`}
                      >
                        {cat.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative min-w-[140px] sm:w-44 flex-1 sm:flex-initial">
                  <Search className="w-3 h-3 absolute left-2 top-2.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    placeholder="Search files..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 pl-7 pr-2 text-xs bg-surface-3 border-border-subtle rounded-none font-mono w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* REGION 3: ISOLATED SCROLLABLE CONTENT */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {/* TAB 1: MEDIA LIBRARY */}
            <TabsContent value="library" className="m-0 space-y-2 h-full">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <span>Loading workspace media...</span>
                </div>
              ) : libraryFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border-subtle p-6 text-center">
                  <HardDrive className="w-8 h-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs font-semibold text-foreground">No media files found</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs">
                    Upload files directly to Google Drive or switch to the Google Drive Live tab to import files.
                  </p>
                  {isDriveConnected && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTab('upload')}
                      className="mt-3 rounded-none text-xs gap-1.5"
                    >
                      <Upload className="w-3 h-3" /> Upload to Drive
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {libraryFiles.map((file) => {
                    const isSelected = selectedMap.has(file.fileId || file.id);
                    return (
                      <div
                        key={file.id || file.fileId}
                        onClick={() =>
                          toggleSelect({
                            id: file.id,
                            fileId: file.fileId,
                            filename: file.filename,
                            mimeType: file.mimeType,
                            size: file.size,
                            driveUrl: file.driveUrl,
                            thumbnailUrl: file.thumbnailUrl,
                            provider: 'google-drive',
                            googleConnectionId: file.googleConnectionId
                          })
                        }
                        className={`group relative p-2.5 border cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-primary/10 border-primary ring-1 ring-primary'
                            : 'bg-card border-border-subtle hover:border-foreground/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="p-1.5 bg-surface-3 border border-border-subtle shrink-0">
                            {getFileIcon(file.mimeType, file.filename)}
                          </div>
                          <div className="flex items-center gap-1">
                            {file.driveUrl && (
                              <a
                                href={file.driveUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground hover:text-primary p-0.5"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <div
                              className={`w-4 h-4 rounded-none border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'border-border-subtle group-hover:border-foreground/40'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate" title={file.filename}>
                            {file.filename}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mt-1">
                            <span>{formatBytes(file.size)}</span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-border-subtle">
                              Drive
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* TAB 2: GOOGLE DRIVE LIVE */}
            <TabsContent value="drive" className="m-0 space-y-2 h-full">
              {!isDriveConnected ? (
                <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border-subtle p-6 text-center">
                  <Cloud className="w-8 h-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs font-semibold text-foreground">Google Drive Not Connected</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs">
                    Please connect Google Drive in Settings to browse and link live Google Drive files.
                  </p>
                </div>
              ) : loading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <span>Browsing Google Drive files...</span>
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border-subtle p-6 text-center">
                  <Cloud className="w-8 h-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs font-semibold text-foreground">No Google Drive files found</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs">
                    No files found in the connected Drive account matching your filter.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {driveFiles.map((file) => {
                    const isSelected = selectedMap.has(file.id);
                    return (
                      <div
                        key={file.id}
                        onClick={() => handleSelectDriveFile(file)}
                        className={`group relative p-2.5 border cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-primary/10 border-primary ring-1 ring-primary'
                            : 'bg-card border-border-subtle hover:border-foreground/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="p-1.5 bg-surface-3 border border-border-subtle shrink-0">
                            {getFileIcon(file.mimeType, file.name)}
                          </div>
                          <div className="flex items-center gap-1">
                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground hover:text-primary p-0.5"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <div
                              className={`w-4 h-4 rounded-none border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'border-border-subtle group-hover:border-foreground/40'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate" title={file.name}>
                            {file.name}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mt-1">
                            <span>{file.size ? formatBytes(file.size) : 'Cloud Doc'}</span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-400 border-emerald-500/30">
                              Live Drive
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* TAB 3: UPLOAD TO DRIVE */}
            <TabsContent value="upload" className="m-0 space-y-3 h-full">
              {!isDriveConnected ? (
                <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border-subtle p-6 text-center">
                  <Cloud className="w-8 h-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs font-semibold text-foreground">Google Drive Not Connected</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs">
                    Please connect Google Drive in Settings before uploading files.
                  </p>
                </div>
              ) : (
                <>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'copy';
                      setDropzoneDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropzoneDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropzoneDragging(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleFileUpload(e.dataTransfer.files);
                      }
                    }}
                    className={`border-2 border-dashed transition-colors flex flex-col items-center justify-center p-8 text-center cursor-pointer ${
                      dropzoneDragging
                        ? 'border-primary bg-primary/10'
                        : 'border-border-subtle hover:border-primary/50 bg-surface-3/30'
                    }`}
                  >
                    <div className="p-3 bg-primary/10 text-primary rounded-full mb-3">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-semibold text-foreground">
                      Drag and drop files here, or <span className="text-primary underline">browse</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Files are uploaded directly to Google Drive and saved to your Media Library (max 25 MB).
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleFileUpload(e.target.files);
                        }
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {uploadingFiles.length > 0 && (
                    <div className="space-y-1.5 border border-border-subtle p-2.5 bg-surface-3/40">
                      <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider font-mono">
                        Upload Status
                      </p>
                      {uploadingFiles.map((u, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-1.5 bg-card border border-border-subtle text-xs"
                        >
                          <span className="truncate max-w-[300px] font-mono">{u.name}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground font-mono">{formatBytes(u.size)}</span>
                            {u.status === 'uploading' && <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />}
                            {u.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                            {u.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-danger" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* REGION 4: FIXED FOOTER */}
        <div className="p-3.5 bg-surface-3 border-t border-border-subtle flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-muted-foreground font-mono truncate">
            {selectedMap.size} file(s) selected
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="rounded-none text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              className="rounded-none text-xs font-semibold gap-1.5 shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Attach Selected ({selectedMap.size})</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
