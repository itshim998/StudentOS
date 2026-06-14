# StudentOS Monitoring And Log Export

## Status Endpoints

- `GET /api/health`: public liveness and safe readiness summary.
- `GET /api/status`: public production-safe service posture.
- `GET /api/internal/monitoring/status`: operator-session protected status with queue health.

Status responses report configuration readiness, modes, and counts. They do not
return tokens, keys, bucket names, storage paths, or source content.

## Structured Logs

API logs include request id, event name, timestamp, route, status, and elapsed
time. Operator action logs include request id, operator id, role, target user id,
and action. Secret-shaped object fields and bearer values are redacted before
serialization.

## Export Guidance

Ship JSON logs from API and worker stdout to the environment logging service.
Apply least-privilege access and retention appropriate for student metadata.
Keep append-only shard evidence tables as the durable review source for operator
actions and deletion-related billing checks. Do not export raw extracted source
text, Storage paths, or environment values into monitoring tools.

## Alert Scaffold

Pass 22 adds append-only monitoring alert events for high-risk operator actions,
billing cancellation failures, deletion approvals, and export download anomalies.
The current sink is structured logs plus the shard table. External alert
providers are intentionally not active yet.
