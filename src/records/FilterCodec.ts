/**
 * Shared filter literal encoder and decoder.
 * Ensures string literals in filter expressions (e.g. title ~ 'O\'Reilly')
 * are properly escaped during query building and unescaped during parsing.
 */
export class FilterCodec {
  /**
   * Encodes a raw string into a quoted filter string literal with proper escaping.
   * e.g., O'Reilly -> 'O\'Reilly'
   * e.g., C:\path  -> 'C:\\path'
   */
  public static encode(val: any): string {
    if (val === null || val === undefined) return "''";
    const str = String(val);
    const escaped = str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `'${escaped}'`;
  }

  /**
   * Decodes a filter string literal, stripping enclosing quotes and unescaping escape sequences.
   * e.g., 'O\'Reilly' -> O'Reilly
   * e.g., 'C:\\path'  -> C:\path
   */
  public static decode(valStr: string): string {
    if (!valStr) return '';
    const trimmed = String(valStr).trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      const inner = trimmed.slice(1, -1);
      return inner.replace(/\\([\\'"nrt]|.)/gs, (_, char) => {
        switch (char) {
          case 'n': return '\n';
          case 'r': return '\r';
          case 't': return '\t';
          case '\\': return '\\';
          case "'": return "'";
          case '"': return '"';
          default: return char;
        }
      });
    }
    return trimmed;
  }
}

export const encodeFilterString = FilterCodec.encode;
export const decodeFilterString = FilterCodec.decode;
