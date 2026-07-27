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

wrong = """old_results = '''    testResults: (state.testResults || []).map((result) => {
              const { topicEvidence, ...safeResult } = result;
              return safeResult;
            }),'''"""
corrected = """old_results = '''    testResults: (state.testResults || []).map((result) => {
      const { topicEvidence, ...safeResult } = result;
      return safeResult;
    }),'''"""
if wrong not in script:
    raise SystemExit("Could not locate the staged server result projection patch")
script = script.replace(wrong, corrected, 1)

exec(compile(script, "<c01-remediation>", "exec"), {"__name__": "__main__"})
