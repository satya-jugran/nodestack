/**
 * RFC 4180 Compliant CSV Helper for NodeStack
 * Supports delimiter auto-detection, multi-line quoted fields, escaped quotes, and robust serialization.
 */
export class CsvHelper {
  /**
   * Auto-detects delimiter from the first line of CSV (comma, semicolon, or tab).
   */
  public static detectDelimiter(csvText: string): string {
    const firstLine = csvText.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
    let inQuotes = false;
    let commas = 0;
    let semicolons = 0;
    let tabs = 0;

    for (let i = 0; i < firstLine.length; i++) {
      const char = firstLine[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (char === ',') commas++;
        else if (char === ';') semicolons++;
        else if (char === '\t') tabs++;
      }
    }

    if (tabs > commas && tabs > semicolons) return '\t';
    if (semicolons > commas && semicolons > tabs) return ';';
    return ',';
  }

  /**
   * Parses CSV string into an array of row objects keyed by header names.
   */
  public static parse(csvText: string, customDelimiter?: string): Array<Record<string, string>> {
    const text = csvText.replace(/^\uFEFF/, '').trim();
    if (!text) return [];

    const delimiter = customDelimiter || this.detectDelimiter(text);
    const rows = this.parseRawRows(text, delimiter);
    if (rows.length === 0) return [];

    const rawHeaders = rows[0];
    // Clean headers: trim whitespace and remove outer quotes if needed
    const headers = rawHeaders.map((h) => h.trim());

    const result: Array<Record<string, string>> = [];
    for (let r = 1; r < rows.length; r++) {
      const rowValues = rows[r];
      // Skip completely empty lines
      if (rowValues.length === 1 && rowValues[0].trim() === '') {
        continue;
      }

      const rowObj: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        const header = headers[c];
        if (header) {
          rowObj[header] = rowValues[c] !== undefined ? rowValues[c] : '';
        }
      }
      result.push(rowObj);
    }

    return result;
  }

  /**
   * Parses CSV string into a 2D array of string cells according to RFC 4180.
   */
  public static parseRawRows(csvText: string, delimiter = ','): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;
    const len = csvText.length;

    while (i < len) {
      const char = csvText[i];

      if (inQuotes) {
        if (char === '"') {
          if (i + 1 < len && csvText[i + 1] === '"') {
            // Escaped quote: "" -> "
            currentCell += '"';
            i += 2;
            continue;
          } else {
            // Closing quote
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          currentCell += char;
          i++;
          continue;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
          i++;
          continue;
        } else if (char === delimiter) {
          currentRow.push(currentCell);
          currentCell = '';
          i++;
          continue;
        } else if (char === '\r') {
          if (i + 1 < len && csvText[i + 1] === '\n') {
            i++;
          }
          currentRow.push(currentCell);
          currentCell = '';
          rows.push(currentRow);
          currentRow = [];
          i++;
          continue;
        } else if (char === '\n') {
          currentRow.push(currentCell);
          currentCell = '';
          rows.push(currentRow);
          currentRow = [];
          i++;
          continue;
        } else {
          currentCell += char;
          i++;
          continue;
        }
      }
    }

    // Push trailing cell and row
    currentRow.push(currentCell);
    rows.push(currentRow);

    // Remove any trailing blank row if string ended with newline
    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      if (last.length === 1 && last[0] === '' && csvText.endsWith('\n')) {
        rows.pop();
      }
    }

    return rows;
  }

  /**
   * Escapes a single value for CSV output.
   */
  public static escapeValue(val: any, delimiter = ','): string {
    if (val === null || val === undefined) {
      return '';
    }
    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }

    let str: string;
    if (typeof val === 'object') {
      str = JSON.stringify(val);
    } else {
      str = String(val);
    }

    // Check if wrapping with quotes is needed
    if (
      str.includes('"') ||
      str.includes(delimiter) ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Serializes headers and record items into an RFC 4180 CSV string.
   */
  public static serialize(headers: string[], items: Array<Record<string, any>>, delimiter = ','): string {
    const lines: string[] = [];

    // Header row
    lines.push(headers.map((h) => this.escapeValue(h, delimiter)).join(delimiter));

    // Data rows
    for (const item of items) {
      const row = headers.map((h) => this.escapeValue(item[h], delimiter));
      lines.push(row.join(delimiter));
    }

    return lines.join('\r\n');
  }
}
