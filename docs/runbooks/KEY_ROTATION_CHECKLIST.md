# Key Rotation Checklist

- Rotate Auth and shard service keys one environment at a time.
- Rotate AI, embedding, billing, and webhook secrets independently.
- Rotate the internal bootstrap token and operator session signing secret after roster changes or suspected compromise.
- Re-run production preflight and masked live schema verifiers.
- Confirm browser config contains only the Auth project anon key.
- Review logs for redaction after rotation.
