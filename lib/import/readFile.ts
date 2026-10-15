import { INLINE_IMPORT_TYPES, MAX_IMPORT_FILE_BYTES } from "./proposal";

/** Characters of text per request. Gemini returns every set as JSON, so parts stay small. */
export const IMPORT_PART_LENGTH = 12_000;
/** Parts per import, about a megabyte of text. */
export const MAX_IMPORT_PARTS = 80;
const MAX_UNZIPPED_BYTES = 40_000_000;

export type ImportPart =
  | { kind: "text"; text: string }
  | { kind: "inline"; mimeType: string; base64: string };

/** A table or a document's lines, with the header row repeated in every part. */
type Section = { title: string; lines: string[] };

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

type FileLike = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/**
 * Turns picked files into the parts sent to the reader: text for spreadsheets,
 * documents, and text files, split so each part stays small; PDFs and photos whole.
 */
export async function prepareImportFiles<F extends FileLike>(
  files: readonly F[],
  options: { shrinkImage?: (file: F) => Promise<{ mimeType: string; bytes: Uint8Array } | null> } = {},
): Promise<ImportPart[]> {
  const parts: ImportPart[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inline = inlineType(file, bytes);
    if (inline) {
      let payload: { mimeType: string; bytes: Uint8Array } = { mimeType: inline, bytes };
      if (inline.startsWith("image/") && bytes.byteLength > MAX_IMPORT_FILE_BYTES && options.shrinkImage) {
        payload = (await options.shrinkImage(file)) ?? payload;
      }
      if (payload.bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
        throw new ImportFileError(`${file.name} is too large. Keep a PDF or photo under 3 MB.`);
      }
      parts.push({ kind: "inline", mimeType: payload.mimeType, base64: toBase64(payload.bytes) });
      continue;
    }
    const sections = await sectionsOf(file.name, bytes);
    for (const text of splitSections(sections)) {
      parts.push({ kind: "text", text });
    }
  }
  if (parts.length === 0) {
    throw new ImportFileError("That file is empty.");
  }
  if (parts.length > MAX_IMPORT_PARTS) {
    throw new ImportFileError("That file is too long to read at once. Split it into a few smaller files.");
  }
  return parts;
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function inlineType(file: FileLike, bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return "application/pdf";
  }
  const type = file.type.toLowerCase();
  if ((INLINE_IMPORT_TYPES as readonly string[]).includes(type)) {
    return type;
  }
  switch (extension(file.name)) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return null;
  }
}

async function sectionsOf(name: string, bytes: Uint8Array): Promise<Section[]> {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const entries = await unzip(bytes);
    if (entries.has("xl/workbook.xml")) {
      return xlsxSections(entries);
    }
    if (entries.has("word/document.xml")) {
      return [{ title: name, lines: docxLines(text(entries.get("word/document.xml"))) }];
    }
    if (entries.has("content.xml") && entries.has("mimetype")) {
      return [{ title: name, lines: openDocumentLines(text(entries.get("content.xml"))) }];
    }
    const sections: Section[] = [];
    for (const [entryName, entryBytes] of entries) {
      // Routines are plans, not history. Spotter's own export includes them.
      if (/(^|\/)(__macosx|\.)/i.test(entryName) || /routine/i.test(entryName)) {
        continue;
      }
      if (["csv", "tsv", "txt", "json", "md", "xml", "html", "htm"].includes(extension(entryName))) {
        sections.push(...(await sectionsOf(entryName, entryBytes)));
      }
    }
    if (sections.length === 0) {
      throw new ImportFileError(`${name} has no spreadsheet or text inside that can be read.`);
    }
    return sections;
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new ImportFileError(`${name} is an older Office file. Save it as .xlsx or .csv and try again.`);
  }
  const decoded = decodeText(bytes);
  if (decoded === null) {
    throw new ImportFileError(
      `${name} can't be read. Try a spreadsheet (.xlsx or .csv), a text file, a PDF, or a photo.`,
    );
  }
  const ext = extension(name);
  if (ext === "json") {
    try {
      // One long line of JSON can't be split. Indented, it can.
      return [{ title: name, lines: JSON.stringify(JSON.parse(decoded), null, 1).split("\n") }];
    } catch {
      // Not valid JSON. Read it as text.
    }
  }
  if (ext === "html" || ext === "htm" || /^\s*<(!doctype html|html)/i.test(decoded)) {
    return [{ title: name, lines: htmlLines(decoded) }];
  }
  return [{ title: name, lines: decoded.split(/\r\n|\r|\n/) }];
}

/** UTF-8, or UTF-16 with a byte order mark. Null when the bytes are not text. */
function decodeText(bytes: Uint8Array): string | null {
  let decoded: string;
  if (startsWith(bytes, [0xff, 0xfe])) {
    decoded = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (startsWith(bytes, [0xfe, 0xff])) {
    decoded = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  } else {
    decoded = new TextDecoder("utf-8").decode(bytes);
  }
  const sample = decoded.slice(0, 20_000);
  let bad = 0;
  for (const char of sample) {
    if (char === "�" || (char < " " && char !== "\n" && char !== "\r" && char !== "\t")) {
      bad += 1;
    }
  }
  if (sample.length > 0 && bad / sample.length > 0.02) {
    return null;
  }
  return decoded.replace(/^﻿/, "");
}

/**
 * Splits each section into parts of about IMPORT_PART_LENGTH characters.
 * A later part starts with the section's first line, which is usually the column header.
 */
export function splitSections(sections: readonly Section[], limit = IMPORT_PART_LENGTH): string[] {
  const parts: string[] = [];
  for (const section of sections) {
    const lines = section.lines.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      continue;
    }
    const title = `[${section.title}]`;
    const header = (lines[0] ?? "").slice(0, Math.floor(limit / 4));
    const room = Math.max(1, limit - title.length - header.length - 2);
    const pieces = lines.flatMap((line) => {
      const out: string[] = [];
      for (let start = 0; start < line.length; start += room) {
        out.push(line.slice(start, start + room));
      }
      return out;
    });
    let current: string[] = [title];
    let length = title.length;
    for (const piece of pieces) {
      if (current.length > 1 && length + piece.length + 1 > limit) {
        parts.push(current.join("\n"));
        current = [title, header];
        length = title.length + header.length + 1;
      }
      current.push(piece);
      length += piece.length + 1;
    }
    parts.push(current.join("\n"));
  }
  return parts;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function text(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

/** Reads a zip's stored and deflated entries. Spreadsheets and Word files are zips. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end === -1) {
    throw new ImportFileError("That file looks damaged. Try saving it again.");
  }
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== 0x02014b50) {
      throw new ImportFileError("That file looks damaged. Try saving it again.");
    }
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) {
      continue;
    }
    total += size;
    if (total > MAX_UNZIPPED_BYTES) {
      throw new ImportFileError("That file is too large to read.");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);
    if (method === 0) {
      entries.set(name, data);
    } else if (method === 8) {
      entries.set(name, await inflate(data));
    }
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    switch (code.toLowerCase()) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
      }
    }
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1] ?? "") : null;
}

function runText(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let out = "";
  for (const match of xml.matchAll(pattern)) {
    out += decodeXml(match[1] ?? "");
  }
  return out;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Built-in Excel number formats that show a date or a time. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

function excelDate(serial: number, date1904: boolean): string {
  // Old Mac workbooks count days from 1904. 1462 days separate the two systems.
  const ms = Math.round((serial + (date1904 && serial >= 1 ? 1462 : 0)) * 86_400_000) + Date.UTC(1899, 11, 30);
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (serial < 1) {
    return time;
  }
  return Number.isInteger(serial) ? day : `${day} ${time}`;
}

function columnIndex(reference: string | null): number | null {
  const match = reference ? /^([A-Z]+)/.exec(reference) : null;
  if (!match) {
    return null;
  }
  let index = 0;
  for (const char of match[1] ?? "") {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Each worksheet as CSV lines, with dates written out instead of Excel serial numbers. */
function xlsxSections(entries: Map<string, Uint8Array>): Section[] {
  const shared: string[] = [];
  for (const match of text(entries.get("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(runText(match[1] ?? "", "t"));
  }

  const styles = text(entries.get("xl/styles.xml"));
  const customFormats = new Map<number, string>();
  for (const match of styles.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attribute(match[0], "numFmtId"));
    customFormats.set(id, attribute(match[0], "formatCode") ?? "");
  }
  const dateStyles: boolean[] = [];
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  for (const match of cellXfs.matchAll(/<xf\s[^>]*?\/?>/g)) {
    const id = Number(attribute(match[0], "numFmtId") ?? 0);
    dateStyles.push(DATE_FORMAT_IDS.has(id) || isDateFormat(customFormats.get(id) ?? ""));
  }

  const targets = new Map<string, string>();
  for (const match of text(entries.get("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) {
      targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
  }

  const workbook = text(entries.get("xl/workbook.xml"));
  const date1904 = /<workbookPr\s[^>]*date1904="(1|true)"/.test(workbook);
  const sections: Section[] = [];
  for (const match of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const title = attribute(match[0], "name") ?? "Sheet";
    const relation = attribute(match[0], "r:id");
    const path = relation ? targets.get(relation) : undefined;
    const sheet = path ? entries.get(path) : undefined;
    if (!sheet) {
      continue;
    }
    const lines: string[] = [];
    for (const row of text(sheet).matchAll(/<row[\s>][\s\S]*?<\/row>|<row\s[^>]*\/>/g)) {
      const cells: string[] = [];
      for (const cell of row[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c ${cell[1] ?? ""}>`;
        const inner = cell[2] ?? "";
        const type = attribute(tag, "t");
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (type === "s") {
          value = shared[Number(raw)] ?? "";
        } else if (type === "inlineStr") {
          value = runText(inner, "t");
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else if (raw !== undefined) {
          value = decodeXml(raw);
          const style = Number(attribute(tag, "s") ?? 0);
          const number = Number(value);
          if (type !== "str" && dateStyles[style] && Number.isFinite(number)) {
            value = excelDate(number, date1904);
          }
        }
        const column = columnIndex(attribute(tag, "r")) ?? cells.length;
        while (cells.length < column) {
          cells.push("");
        }
        cells[column] = csvCell(value);
      }
      lines.push(cells.join(","));
    }
    sections.push({ title, lines });
  }
  return sections;
}

/** Paragraphs as lines, and a table row as one tab-separated line. */
function docxLines(xml: string): string[] {
  const lines: string[] = [];
  const body = xml.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, (row) => {
    const cells = [...row.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((cell) =>
      runText(cell[0], "w:t").replace(/\t/g, " "),
    );
    return `<w:p><w:t>${escapeXml(cells.join("\t"))}</w:t></w:p>`;
  });
  for (const paragraph of body.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    lines.push(runText(paragraph[0].replace(/<w:tab\/>/g, "<w:t>\t</w:t>"), "w:t"));
  }
  return lines;
}

/** OpenDocument spreadsheets and text: one line per row or paragraph. */
function openDocumentLines(xml: string): string[] {
  const rows = xml
    .replace(/<\/table:table-cell>/g, "\t")
    .replace(/<\/table:table-row>|<\/text:p>|<text:line-break\/>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXml(rows)
    .split("\n")
    .map((line) => line.replace(/\t+$/, ""));
}

function htmlLines(html: string): string[] {
  const stripped = html
    .replace(/<(script|style)[\s>][\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ");
  return decodeXml(stripped).split("\n");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
