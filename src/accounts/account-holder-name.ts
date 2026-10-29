/**
 * A holder name as stored: trimmed, inner runs of spaces collapsed, and a blank
 * name is no name (NULL), so the account shows by its number again.
 */
export function cleanHolderName(value: string | null | undefined): string | null {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  return name || null;
}
