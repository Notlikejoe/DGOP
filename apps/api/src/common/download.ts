const UNSAFE_ATTACHMENT_CHARS = /[\u0000-\u001f\u007f"\\/:*?<>|]+/gu;

export function sanitizeAttachmentFilename(filename: string, fallback = 'download'): string {
  const normalized = filename
    .normalize('NFKC')
    .replace(UNSAFE_ATTACHMENT_CHARS, '-')
    .replace(/\s+/gu, ' ')
    .replace(/^\.+/u, '')
    .trim()
    .slice(0, 160);
  return normalized || fallback;
}

export function contentDispositionAttachment(filename: string): string {
  return `attachment; filename="${sanitizeAttachmentFilename(filename)}"`;
}
