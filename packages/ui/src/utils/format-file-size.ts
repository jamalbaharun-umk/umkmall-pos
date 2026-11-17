/**
 * A file size, as a person reads it.
 *
 * ONE DEFINITION FOR TWO SURFACES A USER SEES SECONDS APART (UMK-967). The composer's
 * attachment chip and the sent message's attachment card describe the same file, and a chip
 * reading `4.8 KB` beside a card reading `4915 bytes` is one file told two ways. This lived
 * only in the chat message component; the composer's `ChatDrawer` needed the same shape, and a
 * second copy is
 * exactly how the two would drift.
 *
 * It sits in `utils/` rather than beside the drawer because it is a general mapping rather than
 * that component's chrome — the same siting rule the class tables follow in reverse.
 *
 * Deliberately NOT `Intl.NumberFormat`: the one decimal place and the binary steps are what the
 * shipped surface already renders, and a locale-aware formatter would change the separator under
 * an Indonesian locale without anyone asking for it.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
