from pathlib import Path

source_path = Path(".github/workflows/c01-assessment-integrity-remediation.yml")
source = source_path.read_text(encoding="utf-8")
start_marker = "          python - <<'PY'\n"
end_marker = "\n          PY\n\n      - name: Install dependencies"
start = source.find(start_marker)
end = source.find(end_marker, start + len(start_marker))
if start < 0 or end < 0:
    raise SystemExit(f"Could not extract staged remediation script: start={start}, end={end}")

block = source[start + len(start_marker):end]
lines = block.splitlines()
script = "\n".join(line[10:] if line.startswith("          ") else line for line in lines) + "\n"

assignment_start = script.find("old_results = '''")
assignment_end = script.find("\nnew_results = '''", assignment_start)
if assignment_start < 0 or assignment_end < 0:
    raise SystemExit(f"Could not locate staged server projection assignment: start={assignment_start}, end={assignment_end}")
corrected = """old_results = '''    testResults: (state.testResults || []).map((result) => {
      const { topicEvidence, ...safeResult } = result;
      return safeResult;
    }),'''"""
script = script[:assignment_start] + corrected + script[assignment_end:]

exec(compile(script, "<c01-remediation>", "exec"), {"__name__": "__main__"})
