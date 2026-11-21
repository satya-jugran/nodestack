import { describe, it, expect } from 'vitest';
import { CronParser } from '../src/cron/CronParser';

describe('CronParser', () => {
  describe('Parsing and Validation', () => {
    it('should successfully parse valid 5-field expressions', () => {
      const parsed = CronParser.parse('*/15 2,4 1-15 1,6 1-5');
      expect(parsed.minutes.values.has(0)).toBe(true);
      expect(parsed.minutes.values.has(15)).toBe(true);
      expect(parsed.minutes.values.has(30)).toBe(true);
      expect(parsed.minutes.values.has(45)).toBe(true);
      expect(parsed.hours.values.has(2)).toBe(true);
      expect(parsed.hours.values.has(4)).toBe(true);
      expect(parsed.daysOfMonth.values.has(1)).toBe(true);
      expect(parsed.daysOfMonth.values.has(15)).toBe(true);
      expect(parsed.months.values.has(1)).toBe(true);
      expect(parsed.months.values.has(6)).toBe(true);
      expect(parsed.daysOfWeek.values.has(1)).toBe(true);
      expect(parsed.daysOfWeek.values.has(5)).toBe(true);
    });

    it('should support month and weekday aliases (case-insensitive)', () => {
      const parsed = CronParser.parse('0 12 * JAN,DEC MON-FRI');
      expect(parsed.months.values.has(1)).toBe(true);
      expect(parsed.months.values.has(12)).toBe(true);
      expect(parsed.daysOfWeek.values.has(1)).toBe(true);
      expect(parsed.daysOfWeek.values.has(5)).toBe(true);
      expect(parsed.daysOfWeek.values.has(0)).toBe(false);
    });

    it('should treat both 0 and 7 as Sunday in daysOfWeek', () => {
      const p1 = CronParser.parse('0 0 * * 0');
      const p2 = CronParser.parse('0 0 * * 7');
      expect(p1.daysOfWeek.values.has(0)).toBe(true);
      expect(p2.daysOfWeek.values.has(0)).toBe(true);
    });

    it('should reject invalid field counts or out of range values', () => {
      expect(() => CronParser.parse('* * *')).toThrow(/Expected exactly 5 fields/);
      expect(() => CronParser.parse('* * * * * *')).toThrow(/Expected exactly 5 fields/);
      expect(() => CronParser.parse('60 * * * *')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('* 24 * * *')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('* * 0 * *')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('* * 32 * *')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('* * * 0 *')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('* * * 13 *')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('* * * * 8')).toThrow(/out of bounds/);
      expect(() => CronParser.parse('10-5 * * * *')).toThrow(/Range start greater than end/);
    });

    it('should validate IANA timezones', () => {
      expect(CronParser.isValidTimezone('UTC')).toBe(true);
      expect(CronParser.isValidTimezone('America/New_York')).toBe(true);
      expect(CronParser.isValidTimezone('Asia/Kolkata')).toBe(true);
      expect(CronParser.isValidTimezone('Europe/London')).toBe(true);
      expect(CronParser.isValidTimezone('Invalid/Timezone_Name')).toBe(false);
      expect(CronParser.isValidTimezone('')).toBe(false);
    });

    it('validate() helper should return boolean and error message without throwing', () => {
      const res1 = CronParser.validate('0 0 * * *', 'UTC');
      expect(res1.valid).toBe(true);
      expect(res1.error).toBeUndefined();

      const res2 = CronParser.validate('99 * * * *', 'UTC');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('out of bounds');

      const res3 = CronParser.validate('0 0 * * *', 'Invalid/Timezone');
      expect(res3.valid).toBe(false);
      expect(res3.error).toContain('Invalid IANA timezone');
    });
  });

  describe('Humanize Summary', () => {
    it('should format common cron patterns into human readable text', () => {
      expect(CronParser.humanize('* * * * *')).toBe('Every minute');
      expect(CronParser.humanize('*/5 * * * *')).toBe('Every 5 minutes');
      expect(CronParser.humanize('0 * * * *')).toBe('Every hour, on the hour');
      expect(CronParser.humanize('15 * * * *')).toBe('Every hour, at minute 15');
      expect(CronParser.humanize('0 0 * * *')).toBe('Every day at midnight');
      expect(CronParser.humanize('0 12 * * *')).toBe('Every day at noon');
      expect(CronParser.humanize('30 14 * * *')).toBe('Every day at 14:30');
      expect(CronParser.humanize('0 9 * * 1-5')).toBe('At 09:00, Monday through Friday');
      expect(CronParser.humanize('0 10 * * 0,6')).toBe('At 10:00, on weekends');
      expect(CronParser.humanize('0 0 1 * *')).toBe('At 00:00, on day 1 of the month');
    });
  });

  describe('Next Run Calculation & Timezone Conversion', () => {
    it('should compute exact next minute run in UTC', () => {
      const base = new Date('2026-06-15T10:14:22Z');
      const { date: next } = CronParser.getNextRun('* * * * *', 'UTC', base);
      expect(next.toISOString()).toBe('2026-06-15T10:15:00.000Z');
    });

    it('should compute step intervals correctly', () => {
      const base = new Date('2026-06-15T10:14:00Z');
      const { date: next } = CronParser.getNextRun('*/5 * * * *', 'UTC', base);
      expect(next.toISOString()).toBe('2026-06-15T10:15:00.000Z');

      const { date: nextNext } = CronParser.getNextRun('*/5 * * * *', 'UTC', next);
      expect(nextNext.toISOString()).toBe('2026-06-15T10:20:00.000Z');
    });

    it('should compute daily schedule in a specific IANA timezone (Asia/Kolkata +05:30)', () => {
      // 09:30 AM in Asia/Kolkata is 04:00 AM UTC
      const base = new Date('2026-06-15T00:00:00Z');
      const { date: next } = CronParser.getNextRun('30 9 * * *', 'Asia/Kolkata', base);
      expect(next.toISOString()).toBe('2026-06-15T04:00:00.000Z');

      const parts = CronParser.getZonedDateTimeParts(next, 'Asia/Kolkata');
      expect(parts.hour).toBe(9);
      expect(parts.minute).toBe(30);
    });

    it('should handle Vixie DOM/DOW OR-rule when both are non-wildcard', () => {
      // Runs on either the 15th of the month OR every Monday at 12:00
      // 2026-06-15 is both the 15th AND a Monday
      // 2026-06-22 is a Monday (not the 15th) -> must match
      const base = new Date('2026-06-15T12:00:00Z');
      const { date: next } = CronParser.getNextRun('0 12 15 * 1', 'UTC', base);
      // Next Monday is 2026-06-22
      expect(next.toISOString()).toBe('2026-06-22T12:00:00.000Z');
    });

    it('should handle Feb 29 leap years', () => {
      // 2026 is not a leap year. 2027 is not. 2028 IS a leap year!
      const base = new Date('2026-01-01T00:00:00Z');
      const { date: next } = CronParser.getNextRun('0 0 29 2 *', 'UTC', base);
      expect(next.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    });

    it('should handle Daylight Saving Time Spring-Forward gap gracefully (compatible resolution)', () => {
      // In America/New_York, on 2026-03-08 at 02:00 clocks jump to 03:00.
      // 02:30 AM does not exist in local time.
      const base = new Date('2026-03-07T12:00:00Z');
      const { date: next, dstAdjusted } = CronParser.getNextRun('30 2 * * *', 'America/New_York', base);

      // The next run must still occur on 2026-03-08 without skipping the whole day
      const parts = CronParser.getZonedDateTimeParts(next, 'America/New_York');
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(3);
      expect(parts.day).toBe(8);
      expect(dstAdjusted).toBe(true);
    });

    it('should handle Daylight Saving Time Fall-Back overlap without double firing', () => {
      // In America/New_York, on 2026-11-01 clocks fall back from 02:00 to 01:00.
      const base = new Date('2026-10-31T12:00:00Z');
      const { date: next } = CronParser.getNextRun('30 1 * * *', 'America/New_York', base);

      const parts = CronParser.getZonedDateTimeParts(next, 'America/New_York');
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(11);
      expect(parts.day).toBe(1);
      expect(parts.hour).toBe(1);
      expect(parts.minute).toBe(30);

      // The next run after that must jump to the next day 2026-11-02, NOT repeat the duplicate hour on 2026-11-01!
      const { date: nextNext } = CronParser.getNextRun('30 1 * * *', 'America/New_York', next);
      const nextParts = CronParser.getZonedDateTimeParts(nextNext, 'America/New_York');
      expect(nextParts.day).toBe(2);
    });

    it('preview() should return structured next runs with formatted strings', () => {
      const base = new Date('2026-01-01T00:00:00Z');
      const preview = CronParser.preview('0 9 * * 1-5', 'America/New_York', 3, base);

      expect(preview.valid).toBe(true);
      expect(preview.description).toBe('At 09:00, Monday through Friday');
      expect(preview.nextRuns.length).toBe(3);
      expect(preview.nextRuns[0].isoUtc).toBeDefined();
      expect(preview.nextRuns[0].zonedFormatted).toBeDefined();
    });

    it('should support standard cron macros (@yearly, @monthly, @weekly, @daily, @hourly)', () => {
      const base = new Date('2026-06-15T10:00:00Z');
      const { date: nextHourly } = CronParser.getNextRun('@hourly', 'UTC', base);
      expect(nextHourly.toISOString()).toBe('2026-06-15T11:00:00.000Z');

      const { date: nextDaily } = CronParser.getNextRun('@daily', 'UTC', base);
      expect(nextDaily.toISOString()).toBe('2026-06-16T00:00:00.000Z');

      const { date: nextWeekly } = CronParser.getNextRun('@weekly', 'UTC', base);
      // Next Sunday after 2026-06-15 (Monday) is 2026-06-21
      expect(nextWeekly.toISOString()).toBe('2026-06-21T00:00:00.000Z');

      const { date: nextMonthly } = CronParser.getNextRun('@monthly', 'UTC', base);
      expect(nextMonthly.toISOString()).toBe('2026-07-01T00:00:00.000Z');

      const { date: nextYearly } = CronParser.getNextRun('@yearly', 'UTC', base);
      expect(nextYearly.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('should support L (last day of month) syntax in dayOfMonth', () => {
      // 2026-02 has 28 days
      const baseFeb = new Date('2026-02-01T00:00:00Z');
      const { date: nextFeb } = CronParser.getNextRun('0 0 L * *', 'UTC', baseFeb);
      expect(nextFeb.toISOString()).toBe('2026-02-28T00:00:00.000Z');

      // 2028-02 has 29 days (leap year)
      const baseFebLeap = new Date('2028-02-01T00:00:00Z');
      const { date: nextFebLeap } = CronParser.getNextRun('0 0 L * *', 'UTC', baseFebLeap);
      expect(nextFebLeap.toISOString()).toBe('2028-02-29T00:00:00.000Z');

      // 2026-04 has 30 days
      const baseApr = new Date('2026-04-01T00:00:00Z');
      const { date: nextApr } = CronParser.getNextRun('0 0 L * *', 'UTC', baseApr);
      expect(nextApr.toISOString()).toBe('2026-04-30T00:00:00.000Z');

      expect(CronParser.humanize('0 0 L * *')).toBe('At 00:00, on the last day of the month');
    });
  });
});
