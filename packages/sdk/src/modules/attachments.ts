import { HttpClient } from '../http/client.js';
import type { Attachment } from '@huntara/schema';

export interface UploadAttachmentPayload {
  googleConnectionId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
  metadata?: Record<string, any>;
}

export interface DownloadAttachmentResult {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentBase64: string;
}

export interface ListAttachmentsParams {
  search?: string;
  category?: string;
  connectionId?: string;
  page?: number;
  limit?: number;
}

export class AttachmentsModule {
  constructor(private readonly client: HttpClient) {}

  public async list(params?: ListAttachmentsParams): Promise<Attachment[]> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category) query.set('category', params.category);
    if (params?.connectionId) query.set('connectionId', params.connectionId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));

    const qs = query.toString();
    return this.client.get<Attachment[]>(`/attachments${qs ? `?${qs}` : ''}`);
  }

  public async get(id: string): Promise<Attachment> {
    return this.client.get<Attachment>(`/attachments/${id}`);
  }

  public async upload(payload: UploadAttachmentPayload): Promise<Attachment> {
    return this.client.post<Attachment>('/attachments/upload', payload);
  }

  public async linkDriveFile(payload: { googleConnectionId: string; fileId: string }): Promise<Attachment> {
    return this.client.post<Attachment>('/attachments/link', payload);
  }

  public async download(id: string): Promise<DownloadAttachmentResult> {
    return this.client.get<DownloadAttachmentResult>(`/attachments/${id}/download`);
  }

  public async delete(id: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/attachments/${id}`);
  }
}
