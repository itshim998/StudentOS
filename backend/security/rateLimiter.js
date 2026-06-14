export class InMemoryRateLimiter {
  constructor({ enabled = false, windowMs = 60_000, maxRequests = 120, now = () => Date.now() } = {}) {
    this.enabled = enabled;
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.now = now;
    this.buckets = new Map();
  }

  check(key, { maxRequests = this.maxRequests, windowMs = this.windowMs } = {}) {
    if (!this.enabled) {
      return { allowed: true, remaining: maxRequests, resetAt: null, disabled: true };
    }
    const now = this.now();
    const bucketKey = String(key || "anonymous");
    const current = this.buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      this.buckets.set(bucketKey, next);
      return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(next.resetAt).toISOString() };
    }
    current.count += 1;
    const remaining = Math.max(0, maxRequests - current.count);
    return {
      allowed: current.count <= maxRequests,
      remaining,
      resetAt: new Date(current.resetAt).toISOString(),
    };
  }
}
