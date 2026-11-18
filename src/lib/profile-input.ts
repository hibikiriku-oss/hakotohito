/**
 * Normalize a required profile string-array field before validation/persistence.
 * Reject mixed/non-array input instead of silently dropping malformed values.
 */
export function normalizeRequiredStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item): item is string => typeof item === "string")) {
    return null;
  }

  const normalized = [...new Set(
    value.map((item) => item.trim()).filter((item) => item.length > 0)
  )];

  return normalized.length > 0 ? normalized : null;
}
