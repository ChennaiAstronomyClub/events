import type { sheets_v4 } from "googleapis";
import { getSheetValuesRange, PAYMENT_COLUMNS } from "./config.js";
import type { SheetData } from "./logic.js";
import {
  cellToApiValue,
  columnIndexToLetter,
  escapeSheetTab,
  findColumnIndex1,
  formatSheetDateTime,
  sanitizeCell,
} from "./utils.js";
import { getSheetsClient, getSpreadsheetId } from "./client.js";

export class SheetRepository {
  constructor(
    private readonly spreadsheetId: string,
    private readonly sheetTab: string,
    private readonly sheets: sheets_v4.Sheets = getSheetsClient()
  ) {}

  private tabRef(): string {
    return escapeSheetTab(this.sheetTab);
  }

  async readSheetData(): Promise<SheetData> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: getSheetValuesRange(this.sheetTab, this.tabRef()),
      majorDimension: "ROWS",
    });
    const values = res.data.values ?? [];
    if (values.length < 2) {
      const headers = values.length === 1 ? values[0].map(String) : [];
      return { headers, rows: [] };
    }
    const headers = values[0].map(String);
    const rows = values.slice(1);
    return { headers, rows };
  }

  async ensurePaymentColumns(): Promise<void> {
    const data = await this.readSheetData();
    await this.ensureColumnMap([...PAYMENT_COLUMNS], data);
  }

  /**
   * Resolve 1-based column indices. Re-reads only when new headers were written.
   */
  async ensureColumnMap(
    colNames: string[],
    initial?: SheetData
  ): Promise<{ map: Record<string, number>; data: SheetData }> {
    const unique: string[] = [];
    for (const name of colNames) {
      if (!unique.includes(name)) unique.push(name);
    }

    let data = initial ?? (await this.readSheetData());
    const headers = [...data.headers];
    const map: Record<string, number> = {};
    const toAppend: string[] = [];

    for (const name of unique) {
      let idx = headers.indexOf(name);
      if (idx === -1) {
        headers.push(name);
        toAppend.push(sanitizeCell(name) as string);
        idx = headers.length - 1;
      }
      map[name] = idx + 1;
    }

    if (toAppend.length > 0) {
      const startCol = data.headers.length + 1;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.tabRef()}!${columnIndexToLetter(startCol)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [toAppend] },
      });
      data = await this.readSheetData();
      for (const name of unique) {
        const found = findColumnIndex1(data.headers, name);
        // Keep in-memory index when read range is narrower than written headers.
        if (found > 0) map[name] = found;
      }
    }

    return { map, data };
  }

  /** Append a registration row in one API call (no pre-read for row index). */
  async appendRow(
    colMap: Record<string, number>,
    fields: Array<{ key: string; value: unknown }>
  ): Promise<number> {
    const cols = Object.values(colMap);
    if (cols.length === 0) throw new Error("appendRow: empty column map");
    const maxCol = Math.max(...cols);
    const rowData: unknown[] = new Array(maxCol).fill("");
    for (const { key, value } of fields) {
      const col = colMap[key];
      if (col) rowData[col - 1] = cellToApiValue(value);
    }

    const endCol = columnIndexToLetter(maxCol);
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.tabRef()}!A1:${endCol}1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [rowData.map((v) => (v === undefined || v === null ? "" : v))],
      },
    });
    const updatedRange = res.data.updates?.updatedRange ?? "";
    const rowMatch = updatedRange.match(/!.*?(\d+)(?::|$)/);
    if (rowMatch) return Number(rowMatch[1]);
    const rows = res.data.updates?.updatedRows;
    if (typeof rows === "number" && rows > 0) return rows;
    return 0;
  }

  async writeRowWithExtras(
    rowIndex: number,
    colMap: Record<string, number>,
    keys: string[],
    values: unknown[],
    extras: Array<{ key: string; value: unknown }>
  ): Promise<void> {
    const cols = Object.values(colMap);
    if (cols.length === 0) return;
    const maxCol = Math.max(...cols);
    const rowData: unknown[] = new Array(maxCol).fill("");

    for (let i = 0; i < keys.length; i++) {
      const col = colMap[keys[i]];
      if (col) rowData[col - 1] = cellToApiValue(values[i]);
    }
    for (const extra of extras) {
      const col = colMap[extra.key];
      if (col) rowData[col - 1] = cellToApiValue(extra.value);
    }

    const endCol = columnIndexToLetter(maxCol);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.tabRef()}!A${rowIndex}:${endCol}${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [rowData.map((v) => (v === undefined || v === null ? "" : v))],
      },
    });
  }

  private buildExpireValueRanges(
    rowsToExpire: number[],
    headers: string[],
    now: Date,
    seatStatusCol: number
  ): sheets_v4.Schema$ValueRange[] {
    const paymentStatusCol = findColumnIndex1(headers, "PaymentStatus");
    const paymentUpdatedAtCol = findColumnIndex1(headers, "PaymentStatusUpdatedAt");
    const nowStr = formatSheetDateTime(now) as string;
    const data: sheets_v4.Schema$ValueRange[] = [];

    for (const row of rowsToExpire) {
      data.push({
        range: `${this.tabRef()}!${columnIndexToLetter(paymentStatusCol)}${row}`,
        values: [["Expired"]],
      });
      data.push({
        range: `${this.tabRef()}!${columnIndexToLetter(seatStatusCol)}${row}`,
        values: [["Expired"]],
      });
      if (paymentUpdatedAtCol > 0) {
        data.push({
          range: `${this.tabRef()}!${columnIndexToLetter(paymentUpdatedAtCol)}${row}`,
          values: [[nowStr]],
        });
      }
    }
    return data;
  }

  async batchValuesUpdate(ranges: sheets_v4.Schema$ValueRange[]): Promise<void> {
    if (ranges.length === 0) return;
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: ranges,
      },
    });
  }

  async applyExpiredRows(
    rowsToExpire: number[],
    headers: string[],
    now: Date
  ): Promise<void> {
    if (rowsToExpire.length === 0) return;

    let seatStatusCol = findColumnIndex1(headers, "SeatStatus");
    if (seatStatusCol <= 0) {
      seatStatusCol = (await this.ensureColumnMap(["SeatStatus"], { headers, rows: [] })).map
        .SeatStatus;
    }

    await this.batchValuesUpdate(
      this.buildExpireValueRanges(rowsToExpire, headers, now, seatStatusCol)
    );
  }

  async setCell(rowIndex: number, col1Based: number, value: unknown): Promise<void> {
    const col = columnIndexToLetter(col1Based);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.tabRef()}!${col}${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[cellToApiValue(value)]] },
    });
  }

  /** Write specific named cells in a row without touching any other columns. */
  async updateRowCells(
    rowIndex: number,
    colMap: Record<string, number>,
    fields: Array<{ key: string; value: unknown }>
  ): Promise<void> {
    const ranges = fields
      .map(({ key, value }) => {
        const col = colMap[key];
        if (!col) return null;
        return {
          range: `${this.tabRef()}!${columnIndexToLetter(col)}${rowIndex}`,
          values: [[cellToApiValue(value)]],
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await this.batchValuesUpdate(ranges);
  }
}

export function createRepository(sheetTab: string): SheetRepository {
  return new SheetRepository(getSpreadsheetId(), sheetTab);
}
