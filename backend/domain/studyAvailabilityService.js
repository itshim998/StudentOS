const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_INDEX = new Map(DAY_NAMES.map((name, index) => [name.toLowerCase(), index]));
const BLOCKED_WORDS = /\b(class|lecture|lab|commute|sleep|appointment|work|meeting|commitment|blocked|unavailable)\b/i;
const STUDY_WORDS = /\b(study|revision|practice|focus|reading|available)\b/i;

function clean(value, limit = 2_000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function timeToMinutes(value) {
  const text = clean(value, 30).toLowerCase().replace(/\./g, "");
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (minute > 59 || hour > 23 || (match[3] && (hour < 1 || hour > 12))) return null;
  if (match[3] === "am" && hour === 12) hour = 0;
  if (match[3] === "pm" && hour !== 12) hour += 12;
  return hour * 60 + minute;
}

function minutesToTime(minutes) {
  const safe = Math.max(0, Math.min(1_439, Number(minutes || 0)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function dayIndex(value) {
  return DAY_INDEX.get(clean(value, 20).toLowerCase());
}

function uniqueRules(rules) {
  const seen = new Set();
  return rules.filter((rule) => {
    const key = JSON.stringify(rule);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeWeeklyAvailability(value) {
  const originalText = String(value || "").trim();
  const text = clean(originalText).toLowerCase();
  const availableWindows = [];
  const blockedWindows = [];

  const weekdayAfter = text.match(/weekdays?\s+(?:only\s+)?after\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (weekdayAfter) {
    const start = timeToMinutes(weekdayAfter[1]);
    if (start !== null) availableWindows.push({ days: [1, 2, 3, 4, 5], kind: "after", startTime: minutesToTime(start), precision: "user_supplied" });
  }
  if (/weekends?\s+(?:are\s+)?(?:available\s+)?all\s+day/i.test(text)) {
    availableWindows.push({ days: [6, 0], kind: "all_day", startTime: null, endTime: null, precision: "day_part_only" });
  }

  const onlyDayPart = text.match(/only\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:s)?(?:\s+(morning|afternoon|evening|all\s+day))?/i);
  if (onlyDayPart) {
    const index = dayIndex(onlyDayPart[1]);
    availableWindows.push({ days: [index], kind: "day_part", dayPart: clean(onlyDayPart[2] || "available time", 30), startTime: null, endTime: null, precision: "day_part_only", exclusive: true });
  }

  const explicit = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:s)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)([^,;.\n]*)/gi;
  for (const match of originalText.matchAll(explicit)) {
    const start = timeToMinutes(match[2]);
    const end = timeToMinutes(match[3]);
    if (start === null || end === null || end <= start) continue;
    const rule = {
      days: [dayIndex(match[1])],
      kind: BLOCKED_WORDS.test(match[4]) ? "blocked" : "available",
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      label: clean(match[4], 120) || null,
      precision: "user_supplied",
    };
    (rule.kind === "blocked" ? blockedWindows : availableWindows).push(rule);
  }

  return {
    version: 1,
    originalText,
    availableWindows: uniqueRules(availableWindows),
    blockedWindows: uniqueRules(blockedWindows),
    hasStructuredConstraints: availableWindows.length > 0 || blockedWindows.length > 0,
    retainsUnparsedConstraint: Boolean(originalText),
  };
}

function zonedDateTime(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value || "";
    return { date: `${value("year")}-${value("month")}-${value("day")}`, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
  } catch {
    return { date: date.toISOString().slice(0, 10), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }
}

function eventWindow(item, currentDate, currentDay, timezone) {
  if (item?.archived || item?.status === "archived") return null;
  const recurringDay = Number.isInteger(item?.dayOfWeek) ? item.dayOfWeek : dayIndex(item?.day || item?.location);
  const startFromFields = timeToMinutes(item?.startTime);
  const endFromFields = timeToMinutes(item?.endTime);
  if (startFromFields !== null && endFromFields !== null) {
    const base = { title: clean(item.title, 180), kind: item.kind || (STUDY_WORDS.test(item.title) ? "study" : "blocked") };
    if (recurringDay === currentDay) return { start: startFromFields, end: endFromFields > startFromFields ? endFromFields : 1_440, ...base };
    if (endFromFields <= startFromFields && (recurringDay + 1) % 7 === currentDay) return { start: 0, end: endFromFields, ...base };
  }
  const start = new Date(item?.startsAt || "");
  const end = new Date(item?.endsAt || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  const localStart = zonedDateTime(start, timezone);
  const localEnd = zonedDateTime(end, timezone);
  const base = { title: clean(item.title, 180), kind: item.kind || (STUDY_WORDS.test(item.title) ? "study" : "blocked") };
  if (localStart.date === currentDate) return { start: localStart.minutes, end: localEnd.date === currentDate ? localEnd.minutes : 1_440, ...base };
  if (localEnd.date === currentDate) return { start: 0, end: localEnd.minutes, ...base };
  return null;
}

function subtractWindows(base, blocked) {
  let windows = [base];
  for (const block of blocked) {
    windows = windows.flatMap((window) => {
      if (block.end <= window.start || block.start >= window.end) return [window];
      const pieces = [];
      if (block.start > window.start) pieces.push({ start: window.start, end: block.start });
      if (block.end < window.end) pieces.push({ start: block.end, end: window.end });
      return pieces;
    });
  }
  return windows.filter((window) => window.end - window.start >= 20);
}

export function buildStudyAvailabilityContext(state, clock) {
  const preferences = state.studentProfile?.preferences || {};
  const originalText = String(preferences.scheduleText || preferences.timetableText || "").trim();
  const normalized = preferences.studyAvailability?.originalText === originalText
    ? preferences.studyAvailability
    : normalizeWeeklyAvailability(originalText);
  const currentDay = new Date(`${clock.currentDate}T12:00:00.000Z`).getUTCDay();
  const nowMinutes = timeToMinutes(clock.currentTime) ?? 0;
  const dayRules = (normalized.availableWindows || []).filter((rule) => rule.days?.includes(currentDay));
  const hasExclusiveRule = (normalized.availableWindows || []).some((rule) => rule.exclusive);
  const fixed = (state.timetable || []).map((item) => eventWindow(item, clock.currentDate, currentDay, clock.timezone)).filter(Boolean);
  const studyBlocks = fixed.filter((item) => item.kind === "study" && item.end > nowMinutes);
  const blocked = [
    ...fixed.filter((item) => item.kind !== "study"),
    ...(normalized.blockedWindows || []).filter((rule) => rule.days?.includes(currentDay)).map((rule) => ({
      start: timeToMinutes(rule.startTime), end: timeToMinutes(rule.endTime), title: rule.label || "Protected time", kind: "blocked",
    })).filter((item) => item.start !== null && item.end !== null),
  ].sort((left, right) => left.start - right.start);
  const preferred = Number(preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 0);
  const dailyLimit = preferred > 0 ? Math.min(360, Math.max(15, preferred)) : 180;

  if ((hasExclusiveRule || (normalized.availableWindows || []).length > 0) && !dayRules.length) {
    return {
      originalText, normalized, currentDay: DAY_NAMES[currentDay], capacityMinutes: 0,
      suggestedWindow: "No study availability is recorded for today.", exactWindows: [], fixedCommitments: blocked,
    };
  }

  const exactRule = dayRules.find((rule) => rule.startTime);
  let exactWindows = [];
  let suggestedWindow = originalText ? "Within your stated study availability" : "Within your available study time";
  if (exactRule) {
    const suppliedStart = timeToMinutes(exactRule.startTime);
    const suppliedEnd = timeToMinutes(exactRule.endTime);
    const start = Math.max(nowMinutes, suppliedStart ?? nowMinutes);
    const end = suppliedEnd ?? 1_440;
    exactWindows = end > start ? subtractWindows({ start, end }, blocked) : [];
    suggestedWindow = exactWindows.length ? `After ${minutesToTime(exactWindows[0].start)}` : `After ${exactRule.startTime}`;
  } else if (studyBlocks.length) {
    exactWindows = studyBlocks.flatMap((block) => subtractWindows({ start: Math.max(nowMinutes, block.start), end: block.end }, blocked));
    suggestedWindow = exactWindows.length ? `${minutesToTime(exactWindows[0].start)}–${minutesToTime(exactWindows[0].end)}` : "Within your saved study block";
  } else {
    const dayPart = dayRules.find((rule) => rule.dayPart)?.dayPart;
    if (dayPart) suggestedWindow = `${DAY_NAMES[currentDay]} ${dayPart}`;
    else if (dayRules.some((rule) => rule.kind === "all_day")) suggestedWindow = "During your available weekend study time";
  }
  const exactCapacity = exactWindows.reduce((sum, window) => sum + (window.end - window.start), 0);
  const blockedMinutes = blocked.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);
  const vagueCapacity = Math.max(0, dailyLimit - Math.min(dailyLimit, blockedMinutes));
  const usesExactWindows = Boolean(exactRule || studyBlocks.length);
  const capacityMinutes = Math.max(0, Math.min(dailyLimit, usesExactWindows ? exactCapacity : vagueCapacity));
  return {
    originalText,
    normalized,
    currentDay: DAY_NAMES[currentDay],
    capacityMinutes,
    suggestedWindow,
    exactWindows,
    fixedCommitments: blocked.map((item) => ({ title: item.title, startTime: minutesToTime(item.start), endTime: minutesToTime(item.end) })),
  };
}

export function allocateStudySlots(availability, durations = []) {
  const windows = (availability?.exactWindows || []).map((window) => ({ ...window, cursor: window.start }));
  return durations.map((durationValue) => {
    const duration = Math.max(0, Number(durationValue || 0));
    for (const window of windows) {
      if (window.end - window.cursor < duration) continue;
      const start = window.cursor;
      window.cursor += duration;
      return {
        durationMinutes: duration,
        suggestedWindow: `${minutesToTime(start)}–${minutesToTime(window.cursor)}`,
        scheduledStart: minutesToTime(start),
        scheduledEnd: minutesToTime(window.cursor),
      };
    }
    return {
      durationMinutes: duration,
      suggestedWindow: availability?.suggestedWindow || "Within your available study time",
      scheduledStart: null,
      scheduledEnd: null,
    };
  });
}
