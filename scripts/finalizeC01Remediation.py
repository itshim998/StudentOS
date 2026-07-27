from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match for {label}, found {count}")
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"Missing start marker for {label}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"Missing end marker for {label}")
    return text[:start_index] + replacement + text[end_index:]


# Retire the insecure manual-score UI and direct users to the server-owned test flow.
index_path = Path("frontend/index.html")
index = index_path.read_text(encoding="utf-8")
score_card_start = '''          <section class="studio-workflow-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Practice and credit</p>
                <h3>Record practice result</h3>'''
extension_card_start = '''          <section class="studio-workflow-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Need more time?</p>'''
score_card = '''          <section class="studio-workflow-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Practice and credit</p>
                <h3>Complete a StudentOS test</h3>
              </div>
            </div>
            <p class="studio-helper-copy">Scores and study credits are recorded only from a StudentOS-generated test with server-owned questions and marking.</p>
            <form id="score-form" class="form-grid">
              <select id="score-topic-select" hidden aria-hidden="true" tabindex="-1"></select>
              <button class="primary-button" type="submit">Open Study and Evaluate</button>
            </form>
            <div id="score-result" class="result-box rich-result" aria-live="polite"></div>
          </section>

'''
index = replace_between(index, score_card_start, extension_card_start, score_card, "manual score card")
index_path.write_text(index, encoding="utf-8")

app_path = Path("frontend/scripts/app.js")
app = app_path.read_text(encoding="utf-8")
record_score = '''function recordScore(event) {
  event.preventDefault();
  setResult(els.scoreResult, `
    <strong>Use a StudentOS-generated test</strong>
    <p>Manual score entry has been retired. StudentOS records results only after it evaluates a server-owned test attempt.</p>
    <div class="tag-row">
      ${tag("assessment integrity protected", "source")}
    </div>
  `);
  document.querySelector('.nav-item[data-view="study"]')?.click();
}

'''
app = replace_between(app, "function derivedAnswersForScore", "async function draftExtension", record_score, "manual score submission")
app_path.write_text(app, encoding="utf-8")

# Harden replay handling and cover additional hidden-answer field variants.
domain_path = Path("backend/domain/studentosDomain.js")
domain = domain_path.read_text(encoding="utf-8")
domain = replace_once(
    domain,
    '''      hiddenSolution,
      hiddenSolutions,
      isCorrect,
      ...safeQuestion''',
    '''      hiddenSolution,
      hiddenSolutions,
      hidden_solution,
      hidden_solutions,
      referenceAnswer,
      reference_answer,
      modelSolution,
      model_solution,
      markingScheme,
      marking_scheme,
      isCorrect,
      is_correct,
      ...safeQuestion''',
    "legacy question secret variants",
)
domain = replace_once(
    domain,
    '''  if (existingResult) {
    const settledSignature = session.settledAnswerSignature || legacyAnswerSignature(existingResult.answers || []);
    if (settledSignature !== signature) {
      throw legacyScoreError("This test has already been scored and its answers cannot be changed.", 409, "legacy_test_already_settled");
    }
    return legacyScoreResponse(state, {
      session,
      result: existingResult,
      topic: topicById(state, existingResult.topicId || session.topicId),''',
    '''  if (existingResult) {
    const settledSignature = session.settledAnswerSignature || legacyAnswerSignature(existingResult.answers || []);
    if (settledSignature !== signature) {
      throw legacyScoreError("This test has already been scored and its answers cannot be changed.", 409, "legacy_test_already_settled");
    }
    const replayTopic = topicById(state, existingResult.topicId || session.topicId);
    if (!replayTopic) {
      throw legacyScoreError("This scored test is missing its server-owned academic mapping.", 409, "legacy_test_mapping_unavailable");
    }
    return legacyScoreResponse(state, {
      session,
      result: existingResult,
      topic: replayTopic,''',
    "replay academic mapping",
)
domain_path.write_text(domain, encoding="utf-8")

study_path = Path("backend/ai/studyTestService.js")
study = study_path.read_text(encoding="utf-8")nstudy_old = '''  "providerPayload",
  "provider_payload",
];'''
study_new = '''  "providerPayload",
  "provider_payload",
  "markingScheme",
  "marking_scheme",
  "referenceAnswers",
  "reference_answers",
  "modelSolutions",
  "model_solutions",
];'''
study = replace_once(study, nstudy_old, nstudy_new, "private test session variants")
study = replace_once(
    study,
    '''    hiddenSolution,
    hiddenSolutions,
    isCorrect,
    ...safeQuestion''',
    '''    hiddenSolution,
    hiddenSolutions,
    hidden_solution,
    hidden_solutions,
    referenceAnswer,
    reference_answer,
    modelSolution,
    model_solution,
    markingScheme,
    marking_scheme,
    isCorrect,
    is_correct,
    ...safeQuestion''',
    "study question secret variants",
)
study_path.write_text(study, encoding="utf-8")

server_path = Path("backend/server.js")
server = server_path.read_text(encoding="utf-8")
server = replace_once(
    server,
    '''      hiddenSolutions,
      hidden_solutions,
      internalEvaluation,''',
    '''      hiddenSolutions,
      hidden_solutions,
      modelSolutions,
      model_solutions,
      referenceAnswers,
      reference_answers,
      markingScheme,
      marking_scheme,
      internalEvaluation,''',
    "public test result top-level variants",
)
server = replace_once(
    server,
    '''          expected_answer,
          answerKey: nestedAnswerKey,''',
    '''          expected_answer,
          referenceAnswer,
          reference_answer,
          modelSolution,
          model_solution,
          hiddenSolution,
          hiddenSolutions,
          hidden_solution,
          hidden_solutions,
          markingScheme,
          marking_scheme,
          answerKey: nestedAnswerKey,''',
    "public test result answer variants",
)
server_path.write_text(server, encoding="utf-8")

# Keep smoke verification aligned with the secure contract: forged score authority must be rejected.
smoke_path = Path("scripts/smokeCoreFlows.js")
smoke = smoke_path.read_text(encoding="utf-8")
old_smoke_score = '''    const score = await request(baseUrl, "/api/tests/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, scorePercent: 82, answers: [{ isCorrect: true, concept: "Quadratics" }] }),
    });
    assert.equal(score.result.creditsAwarded, 2);
    assert.equal(score.creditEntry.amount, 2);'''
new_smoke_score = '''    const forgedScoreResponse = await fetch(`${baseUrl}/api/tests/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, scorePercent: 100, answers: [{ isCorrect: true }] }),
    });
    const forgedScore = await forgedScoreResponse.json();
    assert.equal(forgedScoreResponse.status, 400);
    assert.match(String(forgedScore.error || ""), /client-controlled assessment field/i);
    assertNoSensitiveOutput("/api/tests/score forged rejection", forgedScore);'''
smoke = replace_once(smoke, old_smoke_score, new_smoke_score, "smoke forged-score rejection")
smoke_path.write_text(smoke, encoding="utf-8")

# Update the live verifier to assert rejection rather than fabricate a score and credit.
verify_path = Path("scripts/verifySupabaseLive.js")
verify = verify_path.read_text(encoding="utf-8")
verify = replace_once(
    verify,
    '''    ["student_profiles", "profile"],
    ["test_results", "test result"],
    ["credit_ledger", "credit ledger entry"],
    ["ai_usage_ledger", "AI usage entry"],''',
    '''    ["student_profiles", "profile"],
    ["ai_usage_ledger", "AI usage entry"],''',
    "live persisted score assumptions",
)
api_failure_helper = '''
async function apiRequestExpectStatus(apiBase, path, token, expectedStatus, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  assertOk(response.status === expectedStatus, `${path} returned ${response.status}, expected ${expectedStatus}`);
  return payload;
}
'''
verify = replace_once(verify, "\nasync function verifyTables(shardClients) {", api_failure_helper + "\nasync function verifyTables(shardClients) {", "live expected-status helper")
old_live_score = '''  const score = await apiRequest(apiBase, "/api/tests/score", session.access_token, {
    method: "POST",
    body: {
      courseId: "course_alg2",
      topicId: "topic_quadratics",
      type: "mcq",
      answers: ["A", "B", "C", "D"],
      answerKey: ["A", "B", "C", "X"],
    },
  });
  assertOk(score.result?.scorePercent === 75, "Test scoring endpoint did not return expected MCQ score");
  assertOk(score.creditEntry?.amount === 1, "Credit ledger entry was not created by test scoring");'''
new_live_score = '''  const forgedScore = await apiRequestExpectStatus(apiBase, "/api/tests/score", session.access_token, 400, {
    method: "POST",
    body: {
      scorePercent: 100,
      answerKey: ["forged"],
      answers: [{ isCorrect: true }],
    },
  });
  assertOk(/client-controlled assessment field/i.test(String(forgedScore?.error || "")), "Forged score authority was not rejected clearly");'''
verify = replace_once(verify, old_live_score, new_live_score, "live forged-score rejection")
verify = replace_once(
    verify,
    '      "POST /api/tests/score",',
    '      "POST /api/tests/score (forged authority rejected)",',
    "live endpoint summary",
)
verify_path.write_text(verify, encoding="utf-8")

# Extend adversarial coverage to public-field variants and the retired browser path.
test_path = Path("backend/testC01AssessmentIntegrity.js")
test = test_path.read_text(encoding="utf-8")
test = replace_once(test, 'import assert from "node:assert/strict";\n', 'import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n', "test fs import")
test = replace_once(
    test,
    '''  internalEvaluation: { provider: "private" },
  questions: [{ id: "q1", prompt: "Visible prompt", answer: "A", solution: "Private solution", rubric: "Private rubric" }],
  testPaper: {
    answerKey: ["A"],
    gradingRubric: "Private rubric",
    questions: [{ question_number: 1, prompt: "Visible prompt", answer: "A", correctAnswer: "A", solution: "Private solution" }],
  },''',
    '''  internalEvaluation: { provider: "private" },
  marking_scheme: "Private marking scheme",
  reference_answers: ["A"],
  questions: [{ id: "q1", prompt: "Visible prompt", answer: "A", solution: "Private solution", hidden_solution: "Private hidden solution", reference_answer: "A", rubric: "Private rubric", is_correct: true }],
  testPaper: {
    answerKey: ["A"],
    gradingRubric: "Private rubric",
    marking_scheme: "Private marking scheme",
    model_solutions: ["Private model solution"],
    questions: [{ question_number: 1, prompt: "Visible prompt", answer: "A", correctAnswer: "A", model_solution: "Private model solution", solution: "Private solution" }],
  },''',
    "test hidden field variants fixture",
)
test = replace_once(
    test,
    '''assert.equal(projected.internalEvaluation, undefined);
assert.equal(projected.questions[0].answer, undefined);
assert.equal(projected.questions[0].solution, undefined);
assert.equal(projected.testPaper.answerKey, undefined);
assert.equal(projected.testPaper.gradingRubric, undefined);
assert.equal(projected.testPaper.questions[0].correctAnswer, undefined);''',
    '''assert.equal(projected.internalEvaluation, undefined);
assert.equal(projected.marking_scheme, undefined);
assert.equal(projected.reference_answers, undefined);
assert.equal(projected.questions[0].answer, undefined);
assert.equal(projected.questions[0].solution, undefined);
assert.equal(projected.questions[0].hidden_solution, undefined);
assert.equal(projected.questions[0].reference_answer, undefined);
assert.equal(projected.questions[0].is_correct, undefined);
assert.equal(projected.testPaper.answerKey, undefined);
assert.equal(projected.testPaper.gradingRubric, undefined);
assert.equal(projected.testPaper.marking_scheme, undefined);
assert.equal(projected.testPaper.model_solutions, undefined);
assert.equal(projected.testPaper.questions[0].correctAnswer, undefined);
assert.equal(projected.testPaper.questions[0].model_solution, undefined);''',
    "test hidden field variant assertions",
)
frontend_assertions = '''
const frontendApp = readFileSync(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const frontendHtml = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const smokeScript = readFileSync(new URL("../scripts/smokeCoreFlows.js", import.meta.url), "utf8");
const liveVerifier = readFileSync(new URL("../scripts/verifySupabaseLive.js", import.meta.url), "utf8");
assert.doesNotMatch(frontendApp, /api\/tests\/score/);
assert.doesNotMatch(frontendApp, /derivedAnswersForScore/);
assert.doesNotMatch(frontendHtml, /name="scorePercent"/);
assert.doesNotMatch(frontendHtml, /Save test score/);
assert.match(frontendHtml, /server-owned questions and marking/);
assert.match(smokeScript, /forgedScoreResponse\.status, 400/);
assert.match(liveVerifier, /forged authority rejected/);
'''
test = replace_once(test, '\nconsole.log("PASS | C-01 assessment integrity and adversarial scoring tests passed");', frontend_assertions + '\nconsole.log("PASS | C-01 assessment integrity and adversarial scoring tests passed");', "frontend assessment boundary assertions")
test_path.write_text(test, encoding="utf-8")
