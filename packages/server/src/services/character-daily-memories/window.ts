import { getZonedDateParts, normalizePromptTimeZone, resolveZonedWallClockToInstant } from "../conversation/timezone.js";
import type { CharacterDailyMemoryWindow } from "@marinara-engine/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ParsedHandoverTime {
  hour: number;
  minute: number;
}

export function parseHandoverTime(value: string): ParsedHandoverTime {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Handover time must use HH:mm");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Handover time must use HH:mm");
  return { hour, minute };
}

function calendarDateParts(date: Date | string, timeZone?: string) {
  const instant = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid date");
  const parts = getZonedDateParts(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function shiftCalendarDate(parts: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function resolveHandoverInstant(
  calendarDate: { year: number; month: number; day: number } | Date | string,
  handoverTime: string,
  timeZone?: string,
): Date {
  const parts = calendarDate instanceof Date || typeof calendarDate === "string" ? calendarDateParts(calendarDate, timeZone) : calendarDate;
  const { hour, minute } = parseHandoverTime(handoverTime);
  return resolveZonedWallClockToInstant({ ...parts, hour, minute, second: 0 }, normalizePromptTimeZone(timeZone));
}

function windowForEnd(windowEnd: Date, handoverTime: string, timeZone?: string): CharacterDailyMemoryWindow {
  const parts = getZonedDateParts(windowEnd, timeZone);
  const dayKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return {
    dayKey,
    windowStartAt: new Date(windowEnd.getTime() - DAY_MS).toISOString(),
    windowEndAt: windowEnd.toISOString(),
    timeZone,
    handoverTime,
  };
}

export function mostRecentCompletedWindow(now: Date | string, handoverTime: string, timeZone?: string) {
  const instant = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid date");
  const today = calendarDateParts(instant, timeZone);
  let end = resolveHandoverInstant(today, handoverTime, timeZone);
  if (end.getTime() > instant.getTime()) end = resolveHandoverInstant(shiftCalendarDate(today, -1), handoverTime, timeZone);
  return windowForEnd(end, handoverTime, timeZone);
}

export function nextScheduledWindow(afterWindowEnd: Date | string, handoverTime: string, timeZone?: string) {
  const end = typeof afterWindowEnd === "string" ? new Date(afterWindowEnd) : afterWindowEnd;
  if (Number.isNaN(end.getTime())) throw new Error("Invalid date");
  const nextDate = shiftCalendarDate(calendarDateParts(end, timeZone), 1);
  return windowForEnd(resolveHandoverInstant(nextDate, handoverTime, timeZone), handoverTime, timeZone);
}

export function enumerateCompletedWindows(
  fromWindowEnd: Date | string,
  throughNow: Date | string,
  handoverTime: string,
  timeZone?: string,
): CharacterDailyMemoryWindow[] {
  const from = typeof fromWindowEnd === "string" ? new Date(fromWindowEnd) : fromWindowEnd;
  const now = typeof throughNow === "string" ? new Date(throughNow) : throughNow;
  if (Number.isNaN(from.getTime()) || Number.isNaN(now.getTime())) throw new Error("Invalid date");
  const latest = mostRecentCompletedWindow(now, handoverTime, timeZone);
  const windows: CharacterDailyMemoryWindow[] = [];
  let cursor = windowForEnd(from, handoverTime, timeZone);
  while (new Date(cursor.windowEndAt).getTime() <= new Date(latest.windowEndAt).getTime()) {
    windows.push(cursor);
    cursor = nextScheduledWindow(cursor.windowEndAt, handoverTime, timeZone);
  }
  return windows;
}
