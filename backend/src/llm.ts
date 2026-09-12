import { fetchText } from './common'

/**
 * LLM Gateway mechanism shared by translation and model verification:
 * candidate selection, candidate-chain routing, request throttling, and
 * OpenAI-compatible simple-completion response parsing. Domain prompts,
 * output validation, persistence, and logs stay with each caller.
 */

export const LLM_BASE_URL = 'https://aihubmix.com/v1'

/**
 * Translation/model candidates (free first, paid fallback). The environment
 * variable name remains CHANGELOG_LLM_MODEL for zero behavior change.
 */
const DEFAULT_LLM_MODELS =
  'coding-glm-5.3-flash-free,coding-glm-5.3-free,coding-kimi-k3-free,gemini-3.7-flash-free,gpt-5.5-free,coding-glm-5-free,coding-glm-5.3'

export function modelCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  // Empty or delimiter-only overrides fall back to the default chain.
  const list = (env.CHANGELOG_LLM_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_LLM_MODELS.split(',')
}

/** Errors that should try the next candidate model. */
export function isCandidateExhausted(e: unknown): boolean {
  const err = e as { status?: number; body?: string; name?: string }
  return (
    err?.status === 403 ||
    err?.status === 404 ||
    err?.status === 429 ||
    (err?.status ?? 0) >= 500 ||
    err?.name === 'TimeoutError' ||
    /no_available_channel/.test(err?.body ?? '')
  )
}

/** Soft-failure sentinel for a 200 response whose domain output is unusable. */
export class CandidateExhausted extends Error {}

export type ChainVerdict<T> =
  | { status: 'answer'; value: T }
  | { status: 'exhausted'; lastErr: unknown }
  | { status: 'fatal'; err: unknown; model: string; index: number }

function isChainExhausted(e: unknown): boolean {
  return e instanceof CandidateExhausted || isCandidateExhausted(e)
}

/** Run a candidate chain without imposing caller-specific output semantics. */
export async function runCandidateChain<T>(
  models: string[],
  attempt: (model: string, index: number, total: number) => Promise<T>,
  onAttempt?: (model: string, index: number, total: number) => void,
): Promise<ChainVerdict<T>> {
  let lastErr: unknown = null
  for (const [i, model] of models.entries()) {
    onAttempt?.(model, i + 1, models.length)
    try {
      return { status: 'answer', value: await attempt(model, i + 1, models.length) }
    } catch (e) {
      if (!isChainExhausted(e)) return { status: 'fatal', err: e, model, index: i + 1 }
      lastErr = e
    }
  }
  return { status: 'exhausted', lastErr }
}

/**
 * Process-wide request gate. The interval and global state deliberately stay
 * identical to the former translate.ts implementation so request timing does
 * not change during extraction.
 */
let nextRequestAt = 0
async function gateRequest(): Promise<void> {
  const intervalMs = Number(process.env.LLM_MIN_REQUEST_INTERVAL_MS) || 12_000
  for (;;) {
    const now = Date.now()
    if (now >= nextRequestAt) {
      nextRequestAt = now + intervalMs
      return
    }
    await new Promise((r) => setTimeout(r, nextRequestAt - now))
  }
}

function extractContent(resp: unknown): string | null {
  const choices = (resp as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content
  return typeof content === 'string' ? content : null
}

/** Make one OpenAI-compatible simple completion request. */
export async function callModel(
  model: string,
  apiKey: string,
  system: string,
  user: string,
): Promise<{ content: string | null; resp: string }> {
  await gateRequest()
  const resp = await fetchText(`${LLM_BASE_URL}/chat/completions`, 60_000, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  try {
    return { content: extractContent(JSON.parse(resp)), resp }
  } catch {
    return { content: null, resp }
  }
}
