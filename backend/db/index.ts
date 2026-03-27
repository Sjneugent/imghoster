import SqliteAdapter from './adapters/sqlite.js';
import PostgresAdapter from './adapters/postgresql.js';
import type BaseAdapter from './BaseAdapter.js';
import type {
  UserProfile,
  UserRow,
  PublicUserRow,
  ImageRow,
  ImageWithStats,
  CreateImageData,
  BlobRow,
  ThumbnailRow,
  AlbumRow,
  CreateAlbumData,
  UpdateAlbumData,
  ImageStatRow,
  TimelineRow,
  ApiTokenCreateData,
  ApiTokenRow,
  ActiveApiTokenRow,
  TotpSecretRow,
  ContentFlagCreateData,
  ContentFlagRow,
  FlagResolutionCreateData,
  FlagStatusCount,
  ListContentFlagsOptions,
  ExportData,
  DbRunResult,
} from './BaseAdapter.js';

let adapter: BaseAdapter | null = null;

function getAdapter(): BaseAdapter {
  if (!adapter) throw new Error('Database not initialized. Call initDB() first.');
  return adapter;
}

async function initDB(config: string | Record<string, unknown>): Promise<BaseAdapter> {
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();

  switch (dbType) {
    case 'sqlite':
      adapter = new SqliteAdapter();
      break;
    case 'postgresql':
    case 'postgres':
    case 'pg':
      adapter = new PostgresAdapter();
      break;
    default:
      throw new Error(
        `Unsupported DB_TYPE: "${dbType}". Supported values: sqlite, postgresql`
      );
  }

  await adapter.init(config);
  return adapter;
}

function getDB(): BaseAdapter {
  return getAdapter();
}

// ── Proxy functions ─────────────────────────────────────────────────────────

async function createUser(username: string, plainPassword: string, isAdmin?: boolean, profile?: UserProfile) {
  return getAdapter().createUser(username, plainPassword, isAdmin, profile);
}

async function getUserByUsername(username: string) {
  return getAdapter().getUserByUsername(username);
}

async function getUserByEmail(email: string) {
  return getAdapter().getUserByEmail(email);
}

async function getUserById(id: number) {
  return getAdapter().getUserById(id);
}

async function listUsers() {
  return getAdapter().listUsers();
}

async function deleteUser(id: number) {
  return getAdapter().deleteUser(id);
}

async function updateUserPassword(id: number, plainPassword: string) {
  return getAdapter().updateUserPassword(id, plainPassword);
}

async function verifyPassword(plainPassword: string, hash: string) {
  return getAdapter().verifyPassword(plainPassword, hash);
}

async function createApiToken(data: ApiTokenCreateData) {
  return getAdapter().createApiToken(data);
}

async function getActiveApiTokenByHash(tokenHash: string) {
  return getAdapter().getActiveApiTokenByHash(tokenHash);
}

async function listApiTokensByUser(userId: number) {
  return getAdapter().listApiTokensByUser(userId);
}

async function revokeApiToken(userId: number, tokenId: number) {
  return getAdapter().revokeApiToken(userId, tokenId);
}

async function touchApiTokenUsage(tokenId: number) {
  return getAdapter().touchApiTokenUsage(tokenId);
}

async function createImage(data: CreateImageData) {
  return getAdapter().createImage(data);
}

async function getImageBySlug(slug: string) {
  return getAdapter().getImageBySlug(slug);
}

async function getImageById(id: number) {
  return getAdapter().getImageById(id);
}

async function listImagesByUser(userId: number) {
  return getAdapter().listImagesByUser(userId);
}

async function listAllImages() {
  return getAdapter().listAllImages();
}

async function deleteImage(id: number) {
  return getAdapter().deleteImage(id);
}

async function slugExists(slug: string) {
  return getAdapter().slugExists(slug);
}

async function searchImages(query: string, userId: number | null, isAdmin: boolean) {
  return getAdapter().searchImages(query, userId, isAdmin);
}

async function getImagesByIds(ids: number[]) {
  return getAdapter().getImagesByIds(ids);
}

async function upsertImageBlob(imageId: number, blobData: Buffer) {
  return getAdapter().upsertImageBlob(imageId, blobData);
}

async function getImageBlobByImageId(imageId: number) {
  return getAdapter().getImageBlobByImageId(imageId);
}

async function upsertImageThumbnail(imageId: number, thumbData: Buffer, width: number, height: number) {
  return getAdapter().upsertImageThumbnail(imageId, thumbData, width, height);
}

async function getImageThumbnail(imageId: number) {
  return getAdapter().getImageThumbnail(imageId);
}

async function createAlbum(data: CreateAlbumData) {
  return getAdapter().createAlbum(data);
}

async function getAlbumById(id: number) {
  return getAdapter().getAlbumById(id);
}

async function listAlbumsByUser(userId: number) {
  return getAdapter().listAlbumsByUser(userId);
}

async function updateAlbum(id: number, data: UpdateAlbumData) {
  return getAdapter().updateAlbum(id, data);
}

async function deleteAlbum(id: number) {
  return getAdapter().deleteAlbum(id);
}

async function addImagesToAlbum(albumId: number, imageIds: number[]) {
  return getAdapter().addImagesToAlbum(albumId, imageIds);
}

async function removeImageFromAlbum(albumId: number, imageId: number) {
  return getAdapter().removeImageFromAlbum(albumId, imageId);
}

async function getAlbumImages(albumId: number) {
  return getAdapter().getAlbumImages(albumId);
}

async function updateImageVisibility(imageId: number, visibility: string) {
  return getAdapter().updateImageVisibility(imageId, visibility);
}

async function getExpiredImages() {
  return getAdapter().getExpiredImages();
}

async function updateImageExpiration(imageId: number, expiresAt: string | null) {
  return getAdapter().updateImageExpiration(imageId, expiresAt);
}

async function getUserStorageUsed(userId: number) {
  return getAdapter().getUserStorageUsed(userId);
}

async function getUserStorageQuota(userId: number) {
  return getAdapter().getUserStorageQuota(userId);
}

async function setUserStorageQuota(userId: number, quotaBytes: number) {
  return getAdapter().setUserStorageQuota(userId, quotaBytes);
}

async function saveTotpSecret(userId: number, secret: string) {
  return getAdapter().saveTotpSecret(userId, secret);
}

async function enableTotp(userId: number) {
  return getAdapter().enableTotp(userId);
}

async function disableTotp(userId: number) {
  return getAdapter().disableTotp(userId);
}

async function getTotpSecret(userId: number) {
  return getAdapter().getTotpSecret(userId);
}

async function isTotpEnabled(userId: number) {
  return getAdapter().isTotpEnabled(userId);
}

async function checkDuplicateHash(fileHash: string | null) {
  return getAdapter().checkDuplicateHash(fileHash);
}

async function getImagesByFileHash(fileHash: string | null) {
  return getAdapter().getImagesByFileHash(fileHash);
}

async function recordView(imageId: number, ipAddress: string | null, referrer: string | null) {
  return getAdapter().recordView(imageId, ipAddress, referrer);
}

async function getImageStats(userId: number | null) {
  return getAdapter().getImageStats(userId);
}

async function getViewsOverTime(imageId: number | null, days?: number, userId?: number | null) {
  return getAdapter().getViewsOverTime(imageId, days, userId);
}

async function exportData() {
  return getAdapter().exportData();
}

async function importData(data: ExportData) {
  return getAdapter().importData(data);
}

async function createContentFlag(data: ContentFlagCreateData) {
  return getAdapter().createContentFlag(data);
}

async function getContentFlag(flagId: number) {
  return getAdapter().getContentFlag(flagId);
}

async function listContentFlags(options?: ListContentFlagsOptions) {
  return getAdapter().listContentFlags(options);
}

async function getFlagCountByStatus() {
  return getAdapter().getFlagCountByStatus();
}

async function updateFlagStatus(flagId: number, newStatus: string) {
  return getAdapter().updateFlagStatus(flagId, newStatus);
}

async function createFlagResolution(data: FlagResolutionCreateData) {
  return getAdapter().createFlagResolution(data);
}

async function getFlagResolutions(flagId: number) {
  return getAdapter().getFlagResolutions(flagId);
}

async function getFlagWithResolutions(flagId: number) {
  return getAdapter().getFlagWithResolutions(flagId);
}

export {
  initDB,
  getDB,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  listUsers,
  deleteUser,
  updateUserPassword,
  verifyPassword,
  createApiToken,
  getActiveApiTokenByHash,
  listApiTokensByUser,
  revokeApiToken,
  touchApiTokenUsage,
  createImage,
  getImageBySlug,
  getImageById,
  listImagesByUser,
  listAllImages,
  deleteImage,
  slugExists,
  searchImages,
  getImagesByIds,
  upsertImageBlob,
  getImageBlobByImageId,
  checkDuplicateHash,
  getImagesByFileHash,
  recordView,
  getImageStats,
  getViewsOverTime,
  exportData,
  importData,
  createContentFlag,
  getContentFlag,
  listContentFlags,
  getFlagCountByStatus,
  updateFlagStatus,
  createFlagResolution,
  getFlagResolutions,
  getFlagWithResolutions,
  upsertImageThumbnail,
  getImageThumbnail,
  createAlbum,
  getAlbumById,
  listAlbumsByUser,
  updateAlbum,
  deleteAlbum,
  addImagesToAlbum,
  removeImageFromAlbum,
  getAlbumImages,
  updateImageVisibility,
  getExpiredImages,
  updateImageExpiration,
  getUserStorageUsed,
  getUserStorageQuota,
  setUserStorageQuota,
  saveTotpSecret,
  enableTotp,
  disableTotp,
  getTotpSecret,
  isTotpEnabled,
};
