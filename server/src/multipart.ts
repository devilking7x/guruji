/**
 * Minimal dependency-free multipart/form-data parser (only what
 * /api/copycheck needs: text fields + one image file). Binary-safe via
 * latin1 1:1 byte mapping; never writes to disk.
 */

export interface MultipartFile {
  fieldName: string;
  filename: string;
  /** declared part content-type, lowercased, params stripped */
  contentType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  /** text fields, first value wins on repeats (still latin1-encoded) */
  fields: Record<string, string>;
  files: MultipartFile[];
}

/** Extract the boundary from a Content-Type header. Null when absent. */
export function getBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const b = (m[1] ?? m[2] ?? "").trim();
  return b.length > 0 && b.length <= 200 ? b : null;
}

/** Decode a latin1-mapped field value to proper UTF-8 text. */
export function decodeField(s: string): string {
  return Buffer.from(s, "latin1").toString("utf8");
}

export function parseMultipart(body: Buffer, boundary: string): ParsedMultipart {
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  // latin1 maps every byte 1:1 to a char — safe to split on ASCII delimiters.
  const text = body.toString("latin1");
  const delim = `--${boundary}`;
  const rawParts = text.split(delim);
  // rawParts[0] = preamble; last = epilogue ("--" or "--\r\n").
  for (let i = 1; i < rawParts.length - 1; i++) {
    let part = rawParts[i];
    if (part.startsWith("\r\n")) part = part.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd);
    const content = part.slice(headerEnd + 4);
    const disp = /content-disposition:\s*form-data;\s*name="([^"]*)"/i.exec(headerText);
    if (!disp) continue;
    const name = disp[1].slice(0, 200);
    const filenameM = /filename="([^"]*)"/i.exec(headerText);
    if (filenameM) {
      const ctM = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
      files.push({
        fieldName: name,
        filename: filenameM[1].slice(0, 255),
        contentType: (ctM?.[1] ?? "").trim().toLowerCase(),
        data: Buffer.from(content, "latin1"),
      });
    } else if (!(name in fields)) {
      fields[name] = content;
    }
  }
  return { fields, files };
}

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

/**
 * Authoritative image-type check via magic bytes (declared Content-Type can
 * lie). Returns null for anything that is not JPEG/PNG/WebP.
 */
export function detectImageMime(data: Buffer): ImageMime | null {
  if (data.length < 12) return null;
  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
    data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  )
    return "image/png";
  // WebP: RIFF .... WEBP
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  )
    return "image/webp";
  return null;
}
