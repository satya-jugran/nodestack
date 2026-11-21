import { CronNextRunItem, CronPreviewResult } from './types';

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export interface ParsedCronField {
  values: Set<number>;
  isWildcard: boolean;
  isLastDay?: boolean;
  min: number;
  max: number;
  raw: string;
}

export const CRON_MACROS: Record<string, string> = {
  '@YEARLY': '0 0 1 1 *',
  '@ANNUALLY': '0 0 1 1 *',
  '@MONTHLY': '0 0 1 * *',
  '@WEEKLY': '0 0 * * 0',
  '@DAILY': '0 0 * * *',
  '@MIDNIGHT': '0 0 * * *',
  '@HOURLY': '0 * * * *',
};

export interface ParsedCron {
  minutes: ParsedCronField;
  hours: ParsedCronField;
  daysOfMonth: ParsedCronField;
  months: ParsedCronField;
  daysOfWeek: ParsedCronField;
  rawExpression: string;
}

export class CronParser {
  /**
   * Validates if a timezone string is a recognized IANA timezone identifier.
   */
  public static isValidTimezone(timeZone: string): boolean {
    if (!timeZone || typeof timeZone !== 'string') return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalizes and validates a timezone, defaulting to 'UTC' if undefined.
   */
  public static normalizeTimezone(timeZone?: string): string {
    if (!timeZone || !timeZone.trim()) return 'UTC';
    const trimmed = timeZone.trim();
    if (!CronParser.isValidTimezone(trimmed)) {
      throw new Error(`Invalid IANA timezone identifier: '${trimmed}'`);
    }
    return trimmed;
  }

  /**
   * Parses and validates a 5-field cron expression into structured numeric sets.
   */
  public static parse(expression: string): ParsedCron {
    if (!expression || typeof expression !== 'string') {
      throw new Error('Cron expression must be a non-empty string');
    }

    const trimmed = expression.trim();
    const macroUpper = trimmed.toUpperCase();
    if (CRON_MACROS[macroUpper]) {
      const expanded = CRON_MACROS[macroUpper];
      const parsed = CronParser.parse(expanded);
      parsed.rawExpression = trimmed;
      return parsed;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression '${trimmed}'. Expected exactly 5 fields (minute hour dayOfMonth month dayOfWeek), received ${parts.length}`
      );
    }

    const minutes = CronParser.parseField(parts[0], 0, 59, 'minute');
    const hours = CronParser.parseField(parts[1], 0, 23, 'hour');
    const daysOfMonth = CronParser.parseField(parts[2], 1, 31, 'dayOfMonth');
    const months = CronParser.parseField(parts[3], 1, 12, 'month', MONTH_NAMES);
    const daysOfWeek = CronParser.parseField(parts[4], 0, 7, 'dayOfWeek', DAY_NAMES, true);

    return {
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      rawExpression: trimmed,
    };
  }

  /**
   * Validates a 5-field cron expression and optional timezone without throwing.
   */
  public static validate(
    expression: string,
    timeZone = 'UTC'
  ): { valid: boolean; error?: string } {
    try {
      CronParser.normalizeTimezone(timeZone);
      CronParser.parse(expression);
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err?.message || String(err) };
    }
  }

  private static parseField(
    raw: string,
    min: number,
    max: number,
    fieldName: string,
    aliases?: Record<string, number>,
    isDayOfWeek = false
  ): ParsedCronField {
    const isWildcard = raw === '*';
    const values = new Set<number>();

    // Support 'L' (Last Day of Month)
    if (fieldName === 'dayOfMonth' && raw.trim().toUpperCase() === 'L') {
      return {
        values: new Set([28, 29, 30, 31]),
        isWildcard: false,
        isLastDay: true,
        min: 1,
        max: 31,
        raw,
      };
    }

    // Replace textual aliases (case-insensitive)
    let normalized = raw.toUpperCase();
    if (aliases) {
      for (const [name, val] of Object.entries(aliases)) {
        normalized = normalized.replace(new RegExp(`\\b${name}\\b`, 'g'), String(val));
      }
    }

    const listParts = normalized.split(',');
    for (const part of listParts) {
      if (!part) {
        throw new Error(`Empty value in ${fieldName} field list: '${raw}'`);
      }

      if (part === '*') {
        for (let i = min; i <= (isDayOfWeek ? 6 : max); i++) {
          values.add(i);
        }
        continue;
      }

      const stepParts = part.split('/');
      if (stepParts.length > 2) {
        throw new Error(`Invalid step syntax in ${fieldName}: '${part}'`);
      }

      let step = 1;
      if (stepParts.length === 2) {
        step = parseInt(stepParts[1], 10);
        if (isNaN(step) || step <= 0) {
          throw new Error(`Step value must be a positive integer in ${fieldName}: '${part}'`);
        }
      }

      const rangePart = stepParts[0];
      let rangeMin = min;
      let rangeMax = isDayOfWeek ? 6 : max;

      if (rangePart === '*' || rangePart === '') {
        // e.g. */5
        rangeMin = min;
        rangeMax = isDayOfWeek ? 6 : max;
      } else if (rangePart.includes('-')) {
        const bounds = rangePart.split('-');
        if (bounds.length !== 2) {
          throw new Error(`Invalid range syntax in ${fieldName}: '${rangePart}'`);
        }
        const start = parseInt(bounds[0], 10);
        const end = parseInt(bounds[1], 10);
        if (isNaN(start) || isNaN(end) || start < min || end > max) {
          throw new Error(
            `Range values out of bounds (${min}-${max}) in ${fieldName}: '${rangePart}'`
          );
        }
        if (start > end) {
          throw new Error(`Range start greater than end in ${fieldName}: '${rangePart}'`);
        }
        rangeMin = start;
        rangeMax = end;
      } else {
        const val = parseInt(rangePart, 10);
        if (isNaN(val) || val < min || val > max) {
          throw new Error(`Value ${val} out of bounds (${min}-${max}) in ${fieldName}: '${rangePart}'`);
        }
        // If step is given (e.g. 5/10), range runs from val to max
        if (stepParts.length === 2) {
          rangeMin = val;
          rangeMax = isDayOfWeek ? 6 : max;
        } else {
          rangeMin = val;
          rangeMax = val;
        }
      }

      for (let i = rangeMin; i <= rangeMax; i += step) {
        if (isDayOfWeek && i === 7) {
          values.add(0); // 7 is Sunday, map to 0
        } else {
          values.add(i);
        }
      }
    }

    if (values.size === 0) {
      throw new Error(`No valid values evaluated for ${fieldName}: '${raw}'`);
    }

    return {
      values,
      isWildcard,
      min,
      max: isDayOfWeek ? 6 : max,
      raw,
    };
  }

  /**
   * Generates a concise human-readable description of the cron schedule.
   */
  public static humanize(expression: string): string {
    try {
      const trimmed = expression.trim();
      const macro = trimmed.toUpperCase();
      if (macro === '@YEARLY' || macro === '@ANNUALLY') return 'Once a year, at midnight of January 1';
      if (macro === '@MONTHLY') return 'Once a month, at midnight of the first day';
      if (macro === '@WEEKLY') return 'Once a week, at midnight on Sunday';
      if (macro === '@DAILY' || macro === '@MIDNIGHT') return 'Every day at midnight';
      if (macro === '@HOURLY') return 'Every hour, on the hour';

      const parsed = CronParser.parse(expression);
      const { minutes, hours, daysOfMonth, months, daysOfWeek } = parsed;

      const pad = (n: number) => String(n).padStart(2, '0');

      if (daysOfMonth.isLastDay && minutes.values.size === 1 && hours.values.size === 1) {
        const m = Array.from(minutes.values)[0];
        const h = Array.from(hours.values)[0];
        const timeStr = `${pad(h)}:${pad(m)}`;
        return `At ${timeStr}, on the last day of the month`;
      }

      // Every minute
      if (
        minutes.isWildcard &&
        hours.isWildcard &&
        daysOfMonth.isWildcard &&
        months.isWildcard &&
        daysOfWeek.isWildcard
      ) {
        return 'Every minute';
      }

      // Every N minutes
      if (
        minutes.raw.startsWith('*/') &&
        hours.isWildcard &&
        daysOfMonth.isWildcard &&
        months.isWildcard &&
        daysOfWeek.isWildcard
      ) {
        return `Every ${minutes.raw.slice(2)} minutes`;
      }

      // Hourly
      if (
        hours.isWildcard &&
        daysOfMonth.isWildcard &&
        months.isWildcard &&
        daysOfWeek.isWildcard
      ) {
        if (minutes.values.size === 1) {
          const m = Array.from(minutes.values)[0];
          return m === 0 ? 'Every hour, on the hour' : `Every hour, at minute ${m}`;
        }
        return `Every hour, at minutes ${Array.from(minutes.values).sort((a,b)=>a-b).join(', ')}`;
      }

      // Specific time every day / days
      if (minutes.values.size === 1 && hours.values.size === 1) {
        const m = Array.from(minutes.values)[0];
        const h = Array.from(hours.values)[0];
        const timeStr = `${pad(h)}:${pad(m)}`;

        if (daysOfMonth.isWildcard && months.isWildcard && daysOfWeek.isWildcard) {
          if (h === 0 && m === 0) return 'Every day at midnight';
          if (h === 12 && m === 0) return 'Every day at noon';
          return `Every day at ${timeStr}`;
        }

        // Specific days of week
        if (daysOfMonth.isWildcard && months.isWildcard && !daysOfWeek.isWildcard) {
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const sortedDays = Array.from(daysOfWeek.values).sort((a, b) => a - b);
          if (sortedDays.length === 5 && sortedDays.join(',') === '1,2,3,4,5') {
            return `At ${timeStr}, Monday through Friday`;
          }
          if (sortedDays.length === 2 && sortedDays.join(',') === '0,6') {
            return `At ${timeStr}, on weekends`;
          }
          const names = sortedDays.map((d) => dayNames[d]).join(', ');
          return `At ${timeStr}, on ${names}`;
        }

        // Specific day of month
        if (!daysOfMonth.isWildcard && months.isWildcard && daysOfWeek.isWildcard) {
          const sortedDoms = Array.from(daysOfMonth.values).sort((a, b) => a - b);
          return `At ${timeStr}, on day ${sortedDoms.join(', ')} of the month`;
        }
      }

      return `Runs on schedule '${expression}'`;
    } catch {
      return `Custom cron expression: ${expression}`;
    }
  }

  /**
   * Helper to inspect the wall-clock components of a UTC Date in a target timezone.
   */
  public static getZonedDateTimeParts(date: Date, timeZone: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    dayOfWeek: number; // 0 = Sunday
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const parts = formatter.formatToParts(date);
    let year = 1970;
    let month = 1;
    let day = 1;
    let hour = 0;
    let minute = 0;
    let second = 0;

    for (const part of parts) {
      if (part.type === 'year') year = parseInt(part.value, 10);
      else if (part.type === 'month') month = parseInt(part.value, 10);
      else if (part.type === 'day') day = parseInt(part.value, 10);
      else if (part.type === 'hour') hour = parseInt(part.value, 10);
      else if (part.type === 'minute') minute = parseInt(part.value, 10);
      else if (part.type === 'second') second = parseInt(part.value, 10);
    }

    // Determine day of week in timezone
    const dayOfWeekFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    });
    const weekdayStr = dayOfWeekFormatter.format(date).toUpperCase();
    const dayOfWeek = DAY_NAMES[weekdayStr] ?? 0;

    return { year, month, day, hour, minute, second, dayOfWeek };
  }

  /**
   * Given a target wall-clock in a timezone, converts it back to an exact UTC Date instant.
   * Handles DST gaps (spring-forward) and overlaps (fall-back) with deterministic 'compatible' resolution.
   */
  public static zonedTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timeZone: string
  ): { date: Date; dstAdjusted: boolean } {
    // Initial UTC guess
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

    // Measure offset difference at this guess
    const partsAtNaive = CronParser.getZonedDateTimeParts(new Date(naiveUtc), timeZone);
    const naiveZonedAsUtc = Date.UTC(
      partsAtNaive.year,
      partsAtNaive.month - 1,
      partsAtNaive.day,
      partsAtNaive.hour,
      partsAtNaive.minute,
      0,
      0
    );

    const offsetMs = naiveZonedAsUtc - naiveUtc;
    const adjustedEpoch = naiveUtc - offsetMs;
    let resultDate = new Date(adjustedEpoch);

    // Verify if adjusted epoch matches the desired wall-clock
    let resultParts = CronParser.getZonedDateTimeParts(resultDate, timeZone);
    let dstAdjusted = false;

    // Check for DST transition discrepancy (e.g. Spring Forward gap where 2:30 doesn't exist)
    if (resultParts.hour !== hour || resultParts.minute !== minute) {
      // Secondary refinement: re-evaluate offset at adjusted date
      const secondZonedAsUtc = Date.UTC(
        resultParts.year,
        resultParts.month - 1,
        resultParts.day,
        resultParts.hour,
        resultParts.minute,
        0,
        0
      );
      const secondOffsetMs = secondZonedAsUtc - resultDate.getTime();
      const refinedEpoch = naiveUtc - secondOffsetMs;
      resultDate = new Date(refinedEpoch);
      resultParts = CronParser.getZonedDateTimeParts(resultDate, timeZone);

      if (resultParts.hour !== hour || resultParts.minute !== minute) {
        // The requested hour/minute falls inside a skipped DST transition gap.
        // Resolve compatibly to the transition boundary.
        dstAdjusted = true;
      }
    }

    return { date: resultDate, dstAdjusted };
  }

  /**
   * Calculates the next run Date strictly greater than `afterDate`.
   */
  public static getNextRun(
    expression: string,
    timeZone = 'UTC',
    afterDate: Date = new Date()
  ): { date: Date; dstAdjusted: boolean } {
    const tz = CronParser.normalizeTimezone(timeZone);
    const parsed = CronParser.parse(expression);

    // Start 1 minute after afterDate, truncated to 00 seconds
    const startMs = afterDate.getTime() + 60 * 1000;
    const searchDate = new Date(Math.floor(startMs / 60000) * 60000);

    let { year, month, day, hour, minute } = CronParser.getZonedDateTimeParts(searchDate, tz);

    const maxYear = year + 8; // Safety search limit: 8 years
    let iterations = 0;
    const maxIterations = 200_000;

    const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

    while (year <= maxYear) {
      iterations++;
      if (iterations > maxIterations) {
        throw new Error(
          `Unable to find matching run time within 8 years for cron expression '${expression}'`
        );
      }

      // 1. Month match
      if (!parsed.months.values.has(month)) {
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
        day = 1;
        hour = 0;
        minute = 0;
        continue;
      }

      // Check max day for this month
      const maxDim = daysInMonth(year, month);
      if (day > maxDim) {
        day = 1;
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
        hour = 0;
        minute = 0;
        continue;
      }

      // 2. Day of Month and Day of Week match (Vixie POSIX standard)
      const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const domMatch = parsed.daysOfMonth.isLastDay
        ? day === maxDim
        : parsed.daysOfMonth.values.has(day);
      const dowMatch = parsed.daysOfWeek.values.has(dayOfWeek);

      let dayMatches = false;
      if (!parsed.daysOfMonth.isWildcard && !parsed.daysOfWeek.isWildcard) {
        // Both restricted: either matches
        dayMatches = domMatch || dowMatch;
      } else if (!parsed.daysOfMonth.isWildcard) {
        dayMatches = domMatch;
      } else if (!parsed.daysOfWeek.isWildcard) {
        dayMatches = dowMatch;
      } else {
        dayMatches = true;
      }

      if (!dayMatches) {
        day++;
        hour = 0;
        minute = 0;
        continue;
      }

      // 3. Hour match
      if (!parsed.hours.values.has(hour)) {
        hour++;
        if (hour > 23) {
          hour = 0;
          day++;
        }
        minute = 0;
        continue;
      }

      // 4. Minute match
      if (!parsed.minutes.values.has(minute)) {
        minute++;
        if (minute > 59) {
          minute = 0;
          hour++;
          if (hour > 23) {
            hour = 0;
            day++;
          }
        }
        continue;
      }

      // Convert zoned wall-clock candidate to UTC instant
      const { date: candidateDate, dstAdjusted } = CronParser.zonedTimeToUtc(
        year,
        month,
        day,
        hour,
        minute,
        tz
      );

      if (candidateDate.getTime() > afterDate.getTime()) {
        return { date: candidateDate, dstAdjusted };
      }

      // If due to DST overlap/jitter the timestamp is <= afterDate, advance 1 minute
      minute++;
      if (minute > 59) {
        minute = 0;
        hour++;
      }
    }

    throw new Error(
      `No upcoming runs found within 8 years for cron expression '${expression}'`
    );
  }

  /**
   * Computes the next `count` run dates after `afterDate`.
   */
  public static getNextRuns(
    expression: string,
    timeZone = 'UTC',
    count = 5,
    afterDate: Date = new Date()
  ): Array<{ date: Date; dstAdjusted: boolean }> {
    const safeCount = Math.max(1, Math.min(count, 50));
    const runs: Array<{ date: Date; dstAdjusted: boolean }> = [];
    let currentAfter = afterDate;

    for (let i = 0; i < safeCount; i++) {
      const next = CronParser.getNextRun(expression, timeZone, currentAfter);
      runs.push(next);
      currentAfter = next.date;
    }

    return runs;
  }

  /**
   * Generates a preview result containing formatted next run dates in both UTC and target timezone.
   */
  public static preview(
    expression: string,
    timeZone = 'UTC',
    count = 5,
    afterDate: Date = new Date()
  ): CronPreviewResult {
    try {
      const tz = CronParser.normalizeTimezone(timeZone);
      const parsed = CronParser.parse(expression);
      const description = CronParser.humanize(parsed.rawExpression);
      const rawRuns = CronParser.getNextRuns(expression, tz, count, afterDate);

      const zonedFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        dateStyle: 'medium',
        timeStyle: 'medium',
        hourCycle: 'h23',
      });

      const nextRuns: CronNextRunItem[] = rawRuns.map((r) => ({
        isoUtc: r.date.toISOString(),
        zonedFormatted: zonedFormatter.format(r.date),
        dstAdjusted: r.dstAdjusted,
      }));

      return {
        valid: true,
        cronExpression: parsed.rawExpression,
        timezone: tz,
        description,
        nextRuns,
      };
    } catch (err: any) {
      return {
        valid: false,
        cronExpression: expression,
        timezone: timeZone || 'UTC',
        nextRuns: [],
        error: err?.message || String(err),
      };
    }
  }
}
