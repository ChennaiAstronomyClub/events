export function sanitizeCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function findColumnIndex1(headers: string[], name: string): number {
  const target = name.trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] ?? "").trim().toLowerCase() === target) return i + 1;
  }
  return -1;
}

export function findHeaderIndex0(headers: string[], name: string): number {
  const col1 = findColumnIndex1(headers, name);
  return col1 > 0 ? col1 - 1 : -1;
}

export function findEmailColumnIndex(headers: string[]): number {
  return findHeaderIndex0(headers, "email");
}

export function normalizePaymentStatus(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pending") return "Pending";
  if (normalized === "paid") return "Paid";
  if (normalized === "expired") return "Expired";
  return "";
}

export function parseSheetDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number" && !Number.isNaN(value)) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const dmyTime = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (dmyTime) {
      const day = Number(dmyTime[1]);
      const month = Number(dmyTime[2]) - 1;
      const year = Number(dmyTime[3]);
      const hour = dmyTime[4] !== undefined ? Number(dmyTime[4]) : 0;
      const minute = dmyTime[5] !== undefined ? Number(dmyTime[5]) : 0;
      const second = dmyTime[6] !== undefined ? Number(dmyTime[6]) : 0;
      const parsedDmy = new Date(year, month, day, hour, minute, second);
      if (!Number.isNaN(parsedDmy.getTime())) return parsedDmy;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function isPaymentRequired(value: unknown): boolean {
  return value === true || String(value).trim().toLowerCase() === "true";
}

export function columnIndexToLetter(col: number): string {
  let letter = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

export function escapeSheetTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export function formatSheetDateTime(d: Date): string {
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${h}:${m}:${s}`;
}

export function cellToApiValue(value: unknown): string | number | boolean {
  if (value instanceof Date) return formatSheetDateTime(value);
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  return String(value);
}
