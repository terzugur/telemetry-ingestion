/**
 * Validation utilities
 * Implementation will be completed in Task 3
 */

/**
 * Validates chargerId format
 * Pattern: [A-Za-z0-9_-]+
 */
export function isValidChargerId(chargerId: string): boolean {
  if (!chargerId || typeof chargerId !== 'string') {
    return false;
  }
  const pattern = /^[A-Za-z0-9_-]+$/;
  return pattern.test(chargerId);
}

// Validates ISO8601 timestamp format
export function isValidTimestamp(timestamp: string): boolean {
  if (!timestamp || typeof timestamp !== 'string') {
    return false;
  }
  try {
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.toISOString() === timestamp;
  } catch {
    return false;
  }
}

/**
 * Checks if timestamp is in the future (beyond clock skew tolerance)
 * Clock skew tolerance: 5 minutes
 */
export function isFutureTimestamp(timestamp: Date): boolean {
  const now = new Date();
  const clockSkewMs = 5 * 60 * 1000; // 5 minutes
  return timestamp.getTime() > now.getTime() + clockSkewMs;
}
