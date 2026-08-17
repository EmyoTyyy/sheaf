import fs from 'node:fs/promises'
import path from 'node:path'
import type { DeepPartial } from '@shared/types'

export type { DeepPartial }

/**
 * Small atomic JSON file store. Writes go to a temporary file first so a crash
 * mid-write cannot leave a truncated settings file behind.
 */
export class JsonStore<T extends object> {
  private cache: T | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly defaults: T,
    private readonly migrate?: (raw: unknown) => Partial<T>
  ) {}

  async read(): Promise<T> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const migrated = this.migrate ? this.migrate(parsed) : (parsed as Partial<T>)
      this.cache = deepMerge(this.defaults, migrated)
    } catch {
      // Missing or corrupt: fall back to defaults rather than failing to start.
      this.cache = structuredClone(this.defaults)
    }
    return this.cache
  }

  async write(value: T): Promise<T> {
    this.cache = value
    const payload = JSON.stringify(value, null, 2)
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.${process.pid}.tmp`
      await fs.writeFile(tmp, payload, 'utf8')
      await fs.rename(tmp, this.filePath)
    })
    await this.writeChain
    return value
  }

  async update(patch: DeepPartial<T>): Promise<T> {
    const current = await this.read()
    return this.write(deepMerge(current, patch))
  }

  async reset(): Promise<T> {
    return this.write(structuredClone(this.defaults))
  }

  invalidate(): void {
    this.cache = null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merges a partial patch onto a base; arrays are replaced, not concatenated. */
export function deepMerge<T extends object>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return structuredClone(base)
  const result = structuredClone(base) as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const existing = result[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value)
    } else {
      result[key] = isPlainObject(value) || Array.isArray(value) ? structuredClone(value) : value
    }
  }
  return result as T
}
