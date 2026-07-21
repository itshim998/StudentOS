# Study Test Answer Preservation Hotfix (2026-07-21)

## Incident and root cause

Typed study-test autosave uses `PATCH /api/study/tests/:sessionId`, but the API advertised only `GET,POST,DELETE,OPTIONS` in its CORS preflight response. Browsers therefore blocked every production answer save before it reached Azure Container Apps. The submission path awaited the same blocked save and then rebuilt the study view from backend state. Because input had not been copied into the in-memory session, that rebuild replaced every textarea with the backend's older empty answer map.

Cloudflare Pages also deployed without the ignored, generated `frontend/vendor/katex` directory. Requests for `/vendor/katex/katex.min.css` fell through to an HTML response instead of returning CSS.

## Correction

- The backend now has one CORS method/header definition for preflight, JSON, download, and error responses. It allows only the methods in use: `GET`, `POST`, `PATCH`, `DELETE`, and `OPTIONS`. Approved origins are echoed exactly with `Vary: Origin`; production does not use a wildcard.
- Every textarea input updates `state.testSessions[].answers` synchronously before debounce or network activity.
- A revision-aware save flow coalesces input, prevents overlapping PATCH writes, sends the complete answer map, and provides a flush used before finish.
- A small `sessionStorage` draft is isolated by authenticated user ID and test-session ID. It is restored only to the matching unfinished typed attempt, is retained through network failures, is removed after the final save and finish are both acknowledged, and is cleared for the signing-out user.
- Save, finish, and evaluation failures keep the existing DOM and show student-safe retry UI. Raw transport and implementation errors are not rendered.
- Finish is replay-safe. The frontend suppresses concurrent finish/evaluation actions and reuses a scoped idempotency key across evaluation retries, preserving the existing backend in-flight and allowance protections.
- `npm run cloudflare:build` vendors KaTeX, writes the public runtime config, and fails unless the CSS, JavaScript, and font files exist and the stylesheet is real CSS rather than an HTML fallback.

## Required redeployment

Both deployment targets must be redeployed; changing only one leaves the incident partially active.

### Azure Container Apps API and worker

1. Push the hotfix commit to `main`.
2. In GitHub Actions, run **Azure Container Apps - StudentOS API and Worker** with the hotfix commit SHA as `image_tag`, `centralindia` as the location, and adaptive recovery left disabled unless its separate launch gate has already been completed.
3. Keep the existing exact `CORS_ORIGINS` environment policy. It must include `https://studentos.sentiqlabs.com` and the approved Pages preview origin, with no wildcard.
4. Wait until both the API and worker report their latest revision as ready.
5. Verify the deployed API without printing environment values:

```powershell
$env:STUDENTOS_AZURE_API_URL="https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io"
npm.cmd run verify:azure-deployment
$headers = @{
  Origin = "https://studentos.sentiqlabs.com"
  "Access-Control-Request-Method" = "PATCH"
  "Access-Control-Request-Headers" = "authorization,content-type,idempotency-key"
}
$response = Invoke-WebRequest -Method Options -Uri "$env:STUDENTOS_AZURE_API_URL/api/study/tests/preflight-check" -Headers $headers
$response.StatusCode
$response.Headers["Access-Control-Allow-Origin"]
$response.Headers["Access-Control-Allow-Methods"]
Remove-Item Env:STUDENTOS_AZURE_API_URL
```

The response must be `204`, the allowed origin must equal `https://studentos.sentiqlabs.com`, and allowed methods must include `PATCH`.

### Cloudflare Pages

1. In the StudentOS Pages project, keep `STUDENTOS_PUBLIC_API_BASE_URL` set to the Azure API origin (currently `https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io`).
2. Set the build command to `npm run cloudflare:build`.
3. Keep the build output directory set to `frontend`.
4. Redeploy the same hotfix commit from `main`. The build must stop if KaTeX CSS, JavaScript, or fonts are absent.
5. Verify the deployed asset responses:

```powershell
(Invoke-WebRequest -Uri "https://studentos.sentiqlabs.com/vendor/katex/katex.min.css").Headers["Content-Type"]
(Invoke-WebRequest -Uri "https://studentos.sentiqlabs.com/vendor/katex/katex.min.js").Headers["Content-Type"]
```

The first response must be CSS and the second JavaScript; neither response body may be the application HTML fallback.

## Production browser verification

1. Sign in as a test student and start a typed Study and Evaluate test.
2. Enter distinct text in every answer, wait for **Answers saved.**, then temporarily block the answer-save request in browser developer tools.
3. Edit every answer and select **Submit for evaluation**.
4. Confirm all text remains, the attempt stays active, the timer continues, and the safe same-device recovery message and retry action appear. Confirm raw `Failed to fetch`, CORS, HTTP-method, provider, and backend details do not appear in the page.
5. Reload before finishing and confirm the same signed-in user recovers the draft. Confirm another user does not receive it.
6. Restore connectivity and retry. Confirm one finish and one evaluation result occur, then confirm the matching session draft is gone.
7. Run `npm.cmd run verify:cloudflare-azure` with the deployed URLs to complete the existing cross-origin production checks.

This hotfix does not change SentIQ Chat/SentIQGPT, Google Classroom's read-only policy, payments, or assignment writeback.
