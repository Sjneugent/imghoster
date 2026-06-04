/**
 * hash-utils.ts – file hashing utilities for duplicate detection.
 * Uses Web Crypto API to compute SHA-256 hashes.
 */

interface DuplicateCheckResult {
  isDuplicate: boolean;
  existing?: { slug: string };
  message?: string;
}

export interface ValidationResult {
  success: boolean;
  fileHash: string | null;
  isDuplicate: boolean;
  existing: { slug: string } | null;
  message?: string;
  error?: boolean;
}

/**
 * Compute SHA-256 hash of a file.
 * @param file - The file to hash.
 * @returns Hex-encoded SHA-256 hash.
 */
export async function computeFileSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if a file hash already exists on the server.
 * @param fileHash - The SHA-256 hash to check.
 * @returns Response containing isDuplicate and optional existing image info.
 */
export async function checkDuplicateHash(fileHash: string): Promise<DuplicateCheckResult> {
  const response = await fetch('/api/images/check-hash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileHash }),
  });

  // Handle both 200 (unique) and 409 (duplicate) as valid responses
  if (response.status === 200 || response.status === 409) {
    return response.json() as Promise<DuplicateCheckResult>;
  }

  if (!response.ok) {
    const error: any = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<DuplicateCheckResult>;
}

/**
 * Validate a file before upload and check for duplicates.
 * @param file - The file to validate.
 * @returns Object with hash and duplicate info.
 */
export async function validateFileBeforeUpload(file: File): Promise<ValidationResult> {
  try {
    const sha256 = await computeFileSHA256(file);
    const dupCheck = await checkDuplicateHash(sha256);
    return {
      success: true,
      fileHash: sha256,
      isDuplicate: dupCheck.isDuplicate,
      existing: dupCheck.existing ?? null,
      message: dupCheck.message,
    };
  } catch (err: any) {
    return {
      success: false,
      fileHash: null,
      isDuplicate: false,
      existing: null,
      message: err.message,
      error: true,
    };
  }
}
