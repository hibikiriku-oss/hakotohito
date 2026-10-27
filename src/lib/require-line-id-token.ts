/**
 * Returns a LINE ID token or throws if it is missing.
 * Call this after LIFF initialization.
 */
export function requireLineIdToken(
  idToken: string | null | undefined
): string {
  if (!idToken) {
    throw new Error(
      "LINE authentication information is missing. Please log in again."
    );
  }

  return idToken;
}
