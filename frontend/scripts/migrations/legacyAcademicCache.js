const ACADEMIC_CACHE_MIGRATION_KEY = "studentos.academic-cache-version";
const ACADEMIC_CACHE_VERSION = "2";
const LEGACY_ACADEMIC_CACHE_KEYS = new Set([
  "studentos.profile",
  "studentos.academic-profile",
  "studentos.workspace",
  "studentos.dashboard",
  "studentos.state",
  "studentos.onboarding",
]);

function knownLegacyAcademicFixture(value) {
  const text = String(value || "").toLowerCase();
  if (["student_demo_001", "cbse-style demo", "mock_google_classroom", "manual_demo", "demo_onboarding.seeded"].some((marker) => text.includes(marker))) {
    return true;
  }
  return ["aarav", "science", "grade 10", "quadratics worksheet", "trigonometry basics", "macbeth"]
    .filter((marker) => text.includes(marker)).length >= 3;
}

export function purgeLegacyAcademicCache(storageTargets = typeof window === "undefined" ? [] : [window.localStorage, window.sessionStorage]) {
  for (const storage of storageTargets) {
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (!key || key === "studentos.auth.session") continue;
        const normalizedKey = key.toLowerCase();
        const fixtureKey = normalizedKey.includes("demo") || normalizedKey.includes("sample") || normalizedKey.includes("seed");
        const legacyAcademicKey = LEGACY_ACADEMIC_CACHE_KEYS.has(normalizedKey);
        if (fixtureKey || (legacyAcademicKey && knownLegacyAcademicFixture(storage.getItem(key)))) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Storage can be unavailable in strict browser contexts; backend state remains authoritative.
    }
  }
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(ACADEMIC_CACHE_MIGRATION_KEY, ACADEMIC_CACHE_VERSION);
  } catch {
    // The migration is safe to repeat when storage is unavailable.
  }
}
