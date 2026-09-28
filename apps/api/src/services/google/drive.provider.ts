import { GoogleAuthService, DRIVE_FILE_SCOPE } from './auth.service.js';
import { GoogleConnectionModel } from '../../db/models/google-connection.model.js';
import { logger } from '../../config/index.js';
import { DriveDomainError } from '../attachment/types.js';

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

export interface UploadDriveFileOptions {
  connectionId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  idempotencyKey?: string;
}

export interface DriveUploadResult {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  webViewLink?: string | null;
  webContentLink?: string | null;
  thumbnailLink?: string | null;
  driveUrl?: string | null;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  isFolder: boolean;
}

export interface ListDriveFilesResult {
  files: DriveFileItem[];
  nextPageToken?: string;
}

export interface ListDriveFilesOptions {
  folderId?: string | undefined;
  search?: string | undefined;
  pageToken?: string | undefined;
  pageSize?: number | undefined;
}

export class GoogleDriveProvider {
  constructor(private readonly authService: GoogleAuthService) {}

  /**
   * Validates whether the given Google connection possesses the drive.file scope.
   */
  public async isDriveAuthorized(connectionId: string): Promise<boolean> {
    const connection = await GoogleConnectionModel.findById(connectionId);
    if (!connection) return false;
    return (
      connection.status === 'active' &&
      (connection.driveStatus === 'authorized' ||
        connection.grantedScopes.includes(DRIVE_FILE_SCOPE) ||
        connection.grantedScopes.includes('https://www.googleapis.com/auth/drive'))
    );
  }

  /**
   * Uploads an attachment binary to Google Drive via multipart upload.
   */
  public async uploadFile(options: UploadDriveFileOptions): Promise<DriveUploadResult> {
    const connection = await GoogleConnectionModel.findById(options.connectionId);
    if (!connection) {
      throw new DriveDomainError('DRIVE_CONNECTION_NOT_FOUND', `Google connection "${options.connectionId}" not found.`, false, false, 404);
    }

    if (connection.status === 'disconnected') {
      throw new DriveDomainError('DRIVE_AUTH_REQUIRED', `Google connection "${connection.email}" is disconnected. Please reconnect.`, true, false, 401);
    }

    const hasScope = connection.grantedScopes.some(
      (s: string) => s === DRIVE_FILE_SCOPE || s === 'https://www.googleapis.com/auth/drive'
    );

    if (!hasScope && connection.driveStatus !== 'authorized') {
      throw new DriveDomainError(
        'DRIVE_AUTH_REQUIRED',
        `Drive authorization required: The connection "${connection.email}" has not granted Google Drive permissions.`,
        true,
        false,
        401
      );
    }

    let accessToken: string;
    try {
      accessToken = await this.authService.getValidAccessToken(options.connectionId);
    } catch (err: any) {
      throw new DriveDomainError(
        'DRIVE_REAUTH_REQUIRED',
        `Failed to obtain valid Google Drive token: ${err.message}`,
        true,
        false,
        401
      );
    }

    const boundary = `----=_Huntara_Drive_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const metadata = JSON.stringify({
      name: options.filename,
      mimeType: options.mimeType,
      description: 'HUNTARA Media Asset'
    });

    const header = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n\r\n--${boundary}\r\nContent-Type: ${options.mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--`;

    const multipartBody = Buffer.concat([
      Buffer.from(header, 'utf8'),
      options.data,
      Buffer.from(footer, 'utf8')
    ]);

    const uploadUrl = `${DRIVE_UPLOAD_URL}&fields=id,name,mimeType,size,webViewLink,webContentLink,iconLink,thumbnailLink`;

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(multipartBody.length)
      },
      body: multipartBody
    });

    const body: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      logger.error({ status: res.status, error: body?.error, connectionId: options.connectionId }, 'Google Drive upload failed');
      if (res.status === 401 || res.status === 403) {
        throw new DriveDomainError(
          'DRIVE_ACCESS_DENIED',
          `Google Drive access denied (HTTP ${res.status}): ${body?.error?.message || 'Unauthorized access.'}`,
          true,
          false,
          res.status
        );
      }
      if (res.status === 404) {
        throw new DriveDomainError('DRIVE_FILE_NOT_FOUND', 'Google Drive upload endpoint not found.', false, false, 404);
      }
      if (res.status === 429) {
        throw new DriveDomainError('DRIVE_RATE_LIMITED', 'Google Drive rate limit exceeded.', false, true, 429);
      }
      throw new DriveDomainError(
        'DRIVE_UPLOAD_FAILED',
        `Google Drive upload failed (HTTP ${res.status}): ${body?.error?.message || 'unknown error'}`,
        false,
        false,
        502
      );
    }

    const webViewLink = body.webViewLink || (body.id ? `https://drive.google.com/file/d/${body.id}/view` : null);

    return {
      fileId: body.id,
      filename: body.name || options.filename,
      mimeType: body.mimeType || options.mimeType,
      size: body.size ? Number(body.size) : options.data.length,
      webViewLink,
      webContentLink: body.webContentLink || null,
      thumbnailLink: body.thumbnailLink || null,
      driveUrl: webViewLink
    };
  }

  /**
   * Downloads binary content for a file from Google Drive.
   */
  public async downloadFile(connectionId: string, fileId: string): Promise<Buffer> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`Google Drive download failed (HTTP ${res.status}) for fileId "${fileId}"`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Retrieves metadata for a file in Google Drive.
   */
  public async getFileMetadata(
    connectionId: string,
    fileId: string
  ): Promise<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    webViewLink?: string | null;
    webContentLink?: string | null;
    thumbnailLink?: string | null;
    modifiedTime?: string | null;
  }> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    const res = await fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,webContentLink,iconLink,thumbnailLink,modifiedTime`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Google Drive getMetadata failed (HTTP ${res.status}): ${body?.error?.message || 'unknown'}`);
    }

    const webViewLink = body.webViewLink || `https://drive.google.com/file/d/${body.id}/view`;

    return {
      id: body.id,
      name: body.name || 'unnamed',
      mimeType: body.mimeType || 'application/octet-stream',
      size: Number(body.size) || 0,
      webViewLink,
      webContentLink: body.webContentLink || null,
      thumbnailLink: body.thumbnailLink || null,
      modifiedTime: body.modifiedTime || null
    };
  }

  /**
   * Deletes a file from Google Drive.
   */
  public async deleteFile(connectionId: string, fileId: string): Promise<void> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok && res.status !== 404) {
      throw new Error(`Google Drive deleteFile failed (HTTP ${res.status})`);
    }
  }

  /**
   * Lists files and folders from Google Drive, supporting folder navigation and search.
   */
  public async listFiles(
    connectionId: string,
    options?: ListDriveFilesOptions
  ): Promise<ListDriveFilesResult> {
    const isAuth = await this.isDriveAuthorized(connectionId);
    if (!isAuth) {
      throw new Error('Drive authorization required: Connection has not granted the drive.file scope.');
    }

    const accessToken = await this.authService.getValidAccessToken(connectionId);

    const queries: string[] = ['trashed = false'];
    if (options?.search) {
      queries.push(`name contains '${options.search.replace(/'/g, "\\'")}'`);
    } else if (options?.folderId) {
      queries.push(`'${options.folderId.replace(/'/g, "\\'")}' in parents`);
    }

    const q = queries.join(' and ');
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents)',
      pageSize: String(options?.pageSize || 50),
      orderBy: 'folder, name'
    });
    if (options?.pageToken) {
      params.set('pageToken', options.pageToken);
    }

    const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Google Drive listFiles failed (HTTP ${res.status}): ${body?.error?.message || 'unknown'}`);
    }

    const files: DriveFileItem[] = (body.files || []).map((f: any) => ({
      id: f.id,
      name: f.name || 'unnamed',
      mimeType: f.mimeType || 'application/octet-stream',
      size: f.size ? Number(f.size) : undefined,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : undefined),
      webContentLink: f.webContentLink || undefined,
      iconLink: f.iconLink,
      thumbnailLink: f.thumbnailLink,
      parents: f.parents,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder'
    }));

    return {
      files,
      nextPageToken: body.nextPageToken || undefined
    };
  }

  /**
   * Retrieves Google Drive storage quota and user information.
   */
  public async getDriveAbout(connectionId: string): Promise<{
    user: { displayName?: string; emailAddress?: string };
    storageQuota: { limit?: number; usage?: number; usageInDrive?: number };
  }> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Google Drive about failed (HTTP ${res.status}): ${body?.error?.message || 'unknown'}`);
    }

    const storageQuota: { limit?: number; usage?: number; usageInDrive?: number } = {};
    if (body.storageQuota?.limit !== undefined && body.storageQuota?.limit !== null) {
      storageQuota.limit = Number(body.storageQuota.limit);
    }
    if (body.storageQuota?.usage !== undefined && body.storageQuota?.usage !== null) {
      storageQuota.usage = Number(body.storageQuota.usage);
    }
    if (body.storageQuota?.usageInDrive !== undefined && body.storageQuota?.usageInDrive !== null) {
      storageQuota.usageInDrive = Number(body.storageQuota.usageInDrive);
    }

    const user: { displayName?: string; emailAddress?: string } = {};
    if (body.user?.displayName) user.displayName = body.user.displayName;
    if (body.user?.emailAddress) user.emailAddress = body.user.emailAddress;

    return {
      user,
      storageQuota
    };
  }

  /**
   * Verifies if a given Google connection can access a specific Drive file.
   */
  public async verifyAccess(connectionId: string, fileId: string): Promise<boolean> {
    try {
      await this.getFileMetadata(connectionId, fileId);
      return true;
    } catch {
      return false;
    }
  }
}
