export interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs?: number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

export class BoundedTokenBucketRateLimiter {
  readonly #capacity: number
  readonly #refillPerMs: number
  readonly #maximumEntries: number
  readonly #buckets = new Map<string, Bucket>()

  constructor(options: {
    readonly capacity: number
    readonly refillIntervalMs: number
    readonly maximumEntries: number
  }) {
    if (
      !Number.isSafeInteger(options.capacity) ||
      options.capacity <= 0 ||
      !Number.isSafeInteger(options.refillIntervalMs) ||
      options.refillIntervalMs <= 0 ||
      !Number.isSafeInteger(options.maximumEntries) ||
      options.maximumEntries <= 0
    ) {
      throw new RangeError('Rate limiter bounds must be positive integers')
    }
    this.#capacity = options.capacity
    this.#refillPerMs = options.capacity / options.refillIntervalMs
    this.#maximumEntries = options.maximumEntries
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    this.#prune(now)
    let bucket = this.#buckets.get(key)
    if (bucket === undefined) {
      if (this.#buckets.size >= this.#maximumEntries) {
        return { allowed: false, retryAfterMs: 1_000 }
      }
      bucket = { tokens: this.#capacity, updatedAt: now }
      this.#buckets.set(key, bucket)
    }
    bucket.tokens = Math.min(
      this.#capacity,
      bucket.tokens + Math.max(0, now - bucket.updatedAt) * this.#refillPerMs,
    )
    bucket.updatedAt = now
    if (bucket.tokens < 1) {
      return {
        allowed: false,
        retryAfterMs: Math.max(
          1,
          Math.ceil((1 - bucket.tokens) / this.#refillPerMs),
        ),
      }
    }
    bucket.tokens -= 1
    return { allowed: true }
  }

  get size(): number {
    return this.#buckets.size
  }

  #prune(now: number): void {
    if (this.#buckets.size < this.#maximumEntries) return
    const fullyRefilledBefore = now - this.#capacity / this.#refillPerMs
    for (const [key, bucket] of this.#buckets) {
      if (bucket.updatedAt <= fullyRefilledBefore) this.#buckets.delete(key)
    }
  }
}
