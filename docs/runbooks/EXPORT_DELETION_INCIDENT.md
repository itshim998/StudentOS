# Export And Deletion Incident Runbook

1. Keep final deletion disabled while investigating.
2. Capture request id, target user id, operator id, and the latest dry-run counts.
3. Review export retention events, deletion reviews, billing cancellation events, and immutable evidence.
4. Re-run a fresh deletion dry run and compare counts before any approval.
5. Do not delete Storage rows with SQL alone. Use the private Storage API boundary.
6. Escalate partial deletion immediately; preserve immutable evidence and stop retries until scope is reviewed.
