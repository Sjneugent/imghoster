import type { RunResult } from 'better-sqlite3';

// ── Shared domain types ─────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  real_name: string | null;
  password_hash: string;
  is_admin: number;
  storage_quota_bytes: number;
  created_at: string;
}

export interface UserProfile {
  email?: string;
  realName?: string;
}

export interface PublicUserRow {
  id: number;
  username: string;
  email: string | null;
  real_name: string | null;
  is_admin: number;
  created_at: string;
}

export interface ImageRow {
  id: number;
  filename: string;
  original_name: string;
  slug: string;
  mime_type: string;
  size: number;
  storage_backend: string;
  file_hash: string | null;
  comment: string | null;
  tags: string | null;
  visibility: string;
  expires_at: string | null;
  user_id: number;
  created_at: string;
}

export interface ImageWithStats extends ImageRow {
  view_count: number;
  username?: string;
}

export interface CreateImageData {
  filename: string;
  originalName: string;
  slug: string;
  mimeType: string;
  size: number;
  userId: number;
  comment?: string | null;
  tags?: string | null;
  fileHash?: string | null;
  storageBackend?: string;
  visibility?: string;
  expiresAt?: string | null;
}

export interface BlobRow {
  image_id: number;
  blob_data: Buffer;
  blob_size: number;
  created_at: string;
}

export interface ThumbnailRow {
  image_id: number;
  thumb_data: Buffer;
  thumb_size: number;
  width: number;
  height: number;
}

export interface AlbumRow {
  id: number;
  name: string;
  description: string | null;
  user_id: number;
  created_at: string;
}

export interface CreateAlbumData {
  name: string;
  description?: string | null;
  userId: number;
}

export interface UpdateAlbumData {
  name?: string;
  description?: string | null;
}

export interface ViewRow {
  id: number;
  image_id: number;
  viewed_at: string;
  ip_address: string | null;
  referrer: string | null;
}

export interface ImageStatRow {
  id: number;
  slug: string;
  original_name: string;
  created_at: string;
  username?: string;
  view_count: number;
  last_viewed: string | null;
}

export interface TimelineRow {
  day: string;
  views: number;
}

export interface ApiTokenCreateData {
  userId: number;
  tokenHash: string;
  label: string | null;
  expiresAt: string;
}

export interface ApiTokenRow {
  id: number;
  label: string | null;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ActiveApiTokenRow {
  id: number;
  user_id: number;
  expires_at: string;
  username: string;
  is_admin: number;
}

export interface TotpSecretRow {
  user_id: number;
  secret: string;
  enabled: number;
  created_at: string;
}

export interface ContentFlagCreateData {
  imageId: number;
  flagType: string;
  reason: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  reporterCountry?: string | null;
}

export interface ContentFlagRow {
  id: number;
  image_id: number;
  flag_type: string;
  reason: string;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_country: string | null;
  status: string;
  created_at: string;
  slug?: string;
  original_name?: string;
  username?: string;
}

export interface FlagResolutionCreateData {
  flagId: number;
  adminId?: number | null;
  action: string;
  notes?: string | null;
  evidenceUrl?: string | null;
}

export interface FlagStatusCount {
  status: string;
  count: number;
}

export interface ListContentFlagsOptions {
  status?: string | null;
  imageId?: number | null;
  limit?: number;
  offset?: number;
}

export interface ExportData {
  users: UserRow[];
  images: ImageRow[];
  image_views: ViewRow[];
  image_blobs: BlobRow[];
  api_tokens: unknown[];
}

export type DbRunResult = RunResult | { changes: number };

/**
 * BaseAdapter – abstract base class defining the database interface contract.
 *
 * All adapters (SQLite, PostgreSQL, etc.) must extend this class and implement
 * every method.
 */
abstract class BaseAdapter {
  abstract init(config: string | Record<string, unknown>): Promise<this>;
  abstract close(): Promise<void>;

  // ── User helpers ──────────────────────────────────────────────────────────
  abstract createUser(username: string, plainPassword: string, isAdmin?: boolean, profile?: UserProfile): Promise<number>;
  abstract getUserByUsername(username: string): Promise<UserRow | undefined>;
  abstract getUserByEmail(email: string): Promise<UserRow | undefined>;
  abstract getUserById(id: number): Promise<PublicUserRow | undefined>;
  abstract listUsers(): Promise<PublicUserRow[]>;
  abstract deleteUser(id: number): Promise<DbRunResult>;
  abstract updateUserPassword(id: number, plainPassword: string): Promise<DbRunResult>;
  abstract verifyPassword(plainPassword: string, hash: string): Promise<boolean>;

  // ── API token helpers ─────────────────────────────────────────────────────
  abstract createApiToken(data: ApiTokenCreateData): Promise<number>;
  abstract getActiveApiTokenByHash(tokenHash: string): Promise<ActiveApiTokenRow | undefined>;
  abstract listApiTokensByUser(userId: number): Promise<ApiTokenRow[]>;
  abstract revokeApiToken(userId: number, tokenId: number): Promise<DbRunResult>;
  abstract touchApiTokenUsage(tokenId: number): Promise<DbRunResult>;

  // ── Image helpers ─────────────────────────────────────────────────────────
  abstract createImage(data: CreateImageData): Promise<number>;
  abstract getImageBySlug(slug: string): Promise<ImageRow | undefined>;
  abstract getImageById(id: number): Promise<ImageRow | undefined>;
  abstract listImagesByUser(userId: number): Promise<ImageWithStats[]>;
  abstract listAllImages(): Promise<ImageWithStats[]>;
  abstract deleteImage(id: number): Promise<DbRunResult>;
  abstract slugExists(slug: string): Promise<boolean>;
  abstract searchImages(query: string, userId: number | null, isAdmin: boolean): Promise<ImageWithStats[]>;
  abstract getImagesByIds(ids: number[]): Promise<ImageRow[]>;
  abstract upsertImageBlob(imageId: number, blobData: Buffer): Promise<void>;
  abstract getImageBlobByImageId(imageId: number): Promise<BlobRow | undefined>;
  abstract checkDuplicateHash(fileHash: string | null): Promise<ImageRow | null | undefined>;
  abstract getImagesByFileHash(fileHash: string | null): Promise<ImageRow[]>;

  // ── Thumbnail helpers ─────────────────────────────────────────────────────
  abstract upsertImageThumbnail(imageId: number, thumbData: Buffer, width: number, height: number): Promise<void>;
  abstract getImageThumbnail(imageId: number): Promise<ThumbnailRow | undefined>;

  // ── Album helpers ─────────────────────────────────────────────────────────
  abstract createAlbum(data: CreateAlbumData): Promise<number>;
  abstract getAlbumById(id: number): Promise<AlbumRow | undefined>;
  abstract listAlbumsByUser(userId: number): Promise<(AlbumRow & { image_count: number })[]>;
  abstract updateAlbum(id: number, data: UpdateAlbumData): Promise<DbRunResult>;
  abstract deleteAlbum(id: number): Promise<DbRunResult>;
  abstract addImagesToAlbum(albumId: number, imageIds: number[]): Promise<void>;
  abstract removeImageFromAlbum(albumId: number, imageId: number): Promise<DbRunResult>;
  abstract getAlbumImages(albumId: number): Promise<ImageWithStats[]>;

  // ── Visibility helpers ────────────────────────────────────────────────────
  abstract updateImageVisibility(imageId: number, visibility: string): Promise<DbRunResult>;

  // ── Expiration helpers ────────────────────────────────────────────────────
  abstract getExpiredImages(): Promise<ImageRow[]>;
  abstract updateImageExpiration(imageId: number, expiresAt: string | null): Promise<DbRunResult>;

  // ── Quota helpers ─────────────────────────────────────────────────────────
  abstract getUserStorageUsed(userId: number): Promise<number>;
  abstract getUserStorageQuota(userId: number): Promise<number>;
  abstract setUserStorageQuota(userId: number, quotaBytes: number): Promise<DbRunResult>;

  // ── TOTP helpers ──────────────────────────────────────────────────────────
  abstract saveTotpSecret(userId: number, secret: string): Promise<void>;
  abstract enableTotp(userId: number): Promise<DbRunResult>;
  abstract disableTotp(userId: number): Promise<DbRunResult>;
  abstract getTotpSecret(userId: number): Promise<TotpSecretRow | undefined>;
  abstract isTotpEnabled(userId: number): Promise<boolean>;

  // ── View / stats helpers ──────────────────────────────────────────────────
  abstract recordView(imageId: number, ipAddress: string | null, referrer: string | null): Promise<void>;
  abstract getImageStats(userId: number | null): Promise<ImageStatRow[]>;
  abstract getViewsOverTime(imageId: number | null, days?: number, userId?: number | null): Promise<TimelineRow[]>;

  // ── Content flagging helpers ──────────────────────────────────────────────
  abstract createContentFlag(data: ContentFlagCreateData): Promise<number>;
  abstract getContentFlag(flagId: number): Promise<ContentFlagRow | null | undefined>;
  abstract listContentFlags(options?: ListContentFlagsOptions): Promise<ContentFlagRow[]>;
  abstract getFlagCountByStatus(): Promise<FlagStatusCount[]>;
  abstract updateFlagStatus(flagId: number, newStatus: string): Promise<DbRunResult>;
  abstract createFlagResolution(data: FlagResolutionCreateData): Promise<number>;
  abstract getFlagResolutions(flagId: number): Promise<unknown[]>;
  abstract getFlagWithResolutions(flagId: number): Promise<(ContentFlagRow & { resolutions: unknown[] }) | null>;

  // ── Data export / import ──────────────────────────────────────────────────
  abstract exportData(): Promise<ExportData>;
  abstract importData(data: ExportData): Promise<void>;
}

export default BaseAdapter;
