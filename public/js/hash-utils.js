/**
 * File hashing utilities for duplicate detection
 * Uses Web Crypto API to compute SHA256 hashes
 */

/**
 * Compute SHA256 hash of a file
 * @param {File} file - The file to hash
 * @returns {Promise<string>} - Hex-encoded SHA256 hash
 */
async function computeFileSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Check if a file hash already exists on the server
 * @param {string} fileHash - The SHA256 hash to check
 * @returns {Promise<Object>} - Response containing isDuplicate and optional existing image info
 */
async function checkDuplicateHash(fileHash) {
  try {
    const response = await fetch('/api/images/check-hash', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileHash }),
    });

    // Handle both 200 (unique) and 409 (duplicate) as valid responses
    if (response.status === 200 || response.status === 409) {
      return response.json();
    }

    // Any other status is an error
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (err) {
    console.error('Error checking file hash:', err);
    throw err;
  }
}

/**
 * Validate a file before upload and check for duplicates
 * @param {File} file - The file to validate
 * @returns {Promise<Object>} - Object with hash and duplicate info
 */
async function validateFileBeforeUpload(file) {
  try {
    // Compute hash
    const sha256 = await computeFileSHA256(file);
    
    // Check for duplicates
    const dupCheck = await checkDuplicateHash(sha256);
    
    return {
      success: true,
      fileHash: sha256,
      isDuplicate: dupCheck.isDuplicate,
      existing: dupCheck.existing || null,
      message: dupCheck.message,
    };
  } catch (err) {
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

export { computeFileSHA256, checkDuplicateHash, validateFileBeforeUpload };
