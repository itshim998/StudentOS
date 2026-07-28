from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT / "backend/repository/studentOsRepository.js"
MIGRATION = ROOT / "supabase/migrations/202607280001_h02_narrow_state_repositories.sql"
DESKTOP_E2E = ROOT / "tests/e2e/studentos-desktop.spec.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


repo = REPO.read_text(encoding="utf-8")
repo = replace_once(
    repo,
    '''  async saveState(session, state) {
    const userId = session?.user?.id || state.studentProfile.id;
    this.states.set(userId, ensureStateShape(clone(state)));
  }
''',
    '''  async saveAcademicContext(session, state) {
    const userId = session?.user?.id || state.studentProfile.id;
    const current = ensureStateShape(clone(this.states.get(userId) || initialStateForUser(session?.user || { id: userId })));
    current.studentProfile = clone(state.studentProfile || current.studentProfile);
    for (const key of collectionKeysForScope(STATE_SCOPE_NAMES.ACADEMIC_CONTEXT, ALL_COLLECTION_KEYS)) {
      if (Object.prototype.hasOwnProperty.call(state, key)) current[key] = clone(state[key] || []);
    }
    this.states.set(userId, ensureStateShape(current));
  }

  async saveState(session, state) {
    const userId = session?.user?.id || state.studentProfile.id;
    this.states.set(userId, ensureStateShape(clone(state)));
  }
''',
    "mock academic context merge",
)
repo = replace_once(
    repo,
    ''': this.mock.saveState(session, state);
  }

  async deleteCollectionRows(session, key, ids) {''',
    ''': this.mock.saveAcademicContext(session, state);
  }

  async deleteCollectionRows(session, key, ids) {''',
    "mock academic context wrapper",
)
repo = replace_once(
    repo,
    ''': this.mock.archiveCollectionRows(session, key, records.map((item) => item?.id).filter(Boolean), options);''',
    ''': this.mock.archiveCollectionRows(session, key, (records || []).map((item) => item?.id).filter(Boolean), options);''',
    "archive wrapper guard",
)
REPO.write_text(repo, encoding="utf-8")

migration = MIGRATION.read_text(encoding="utf-8")
migration = replace_once(
    migration,
    '''  update_assignments text;
  affected integer := 0;
begin''',
    '''  update_assignments text;
  affected integer := 0;
  changed_rows integer := 0;
begin''',
    "transaction patch row counter declaration",
)
migration = replace_once(
    migration,
    '''    get diagnostics affected = affected + row_count;''',
    '''    get diagnostics changed_rows = row_count;
    affected := affected + changed_rows;''',
    "transaction patch delete row count",
)
MIGRATION.write_text(migration, encoding="utf-8")

desktop_test = DESKTOP_E2E.read_text(encoding="utf-8")
desktop_test = replace_once(
    desktop_test,
    'await expect(page.locator("#auth-shell-title")).toHaveText("Sign in to StudentOS");',
    'await expect(page.locator("#auth-shell-title")).toHaveText("Welcome back");',
    "current redesigned auth heading expectation",
)
DESKTOP_E2E.write_text(desktop_test, encoding="utf-8")
