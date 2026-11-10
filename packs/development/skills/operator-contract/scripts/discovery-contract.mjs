// What a project's discovery must decide, as checks its own tests apply (references/discovery-contract.md).
// Each check throws naming the first case or value that differs from the contract.

/**
 * Stale claims (discovery-contract.md > Stale claims). Each case is one discovery input and the answer
 * the contract requires: the job whose claim discovery takes over, or null. `jobs` lists the runtime's
 * queued and running jobs (`operator jobs`); `labeledAt` is when the processing label was last applied.
 */
export const STALE_CLAIM_CASES = [
  {
    name: "a stopped run's claim is stale",
    input: { claimed: true, record: { job: 'j1', at: '2026-11-01T10:00:00Z' }, labeledAt: '2026-11-01T09:59:58Z', jobs: [] },
    stale: 'j1',
  },
  {
    name: "a running job's claim is never stale",
    input: { claimed: true, record: { job: 'j1', at: '2026-11-01T10:00:00Z' }, labeledAt: '2026-11-01T09:59:58Z', jobs: [{ id: 'j1', subject: 'pr-7', status: 'running' }] },
    stale: null,
  },
  {
    name: "a running job's claim is never stale, whatever its subject: a clarification select run claims the pull request it opened",
    input: { claimed: true, record: { job: 'j1', at: '2026-11-01T10:00:00Z' }, labeledAt: '2026-11-01T09:59:58Z', jobs: [{ id: 'j1', subject: 'clarify-queue', status: 'running' }] },
    stale: null,
  },
  {
    name: "a queued job's claim is never stale, whatever its subject: an intake run claims the pull request it opened",
    input: { claimed: true, record: { job: 'j1', at: '2026-11-01T10:00:00Z' }, labeledAt: '2026-11-01T09:59:58Z', jobs: [{ id: 'j1', subject: 'queue', status: 'queued' }] },
    stale: null,
  },
  {
    name: "a claim without a record is someone else's and never stale",
    input: { claimed: true, record: null, labeledAt: '2026-11-01T09:59:58Z', jobs: [] },
    stale: null,
  },
  {
    name: "a label applied after the record is a newer claim, not the stopped run's",
    input: { claimed: true, record: { job: 'j1', at: '2026-11-01T10:00:00Z' }, labeledAt: '2026-11-01T11:00:00Z', jobs: [] },
    stale: null,
  },
  {
    name: 'without the processing label there is no claim to take over',
    input: { claimed: false, record: { job: 'j1', at: '2026-11-01T10:00:00Z' }, labeledAt: null, jobs: [] },
    stale: null,
  },
];

/** Runs a discovery's stale-claim decision on every case; throws naming the first it answers wrongly. */
export function assertStaleClaims(staleClaim) {
  for (const { name, input, stale } of STALE_CLAIM_CASES) {
    const answer = staleClaim(structuredClone(input));
    if ((answer ?? null) !== stale) throw new Error(`stale claim "${name}": expected ${JSON.stringify(stale)}, got ${JSON.stringify(answer)}`);
  }
  return STALE_CLAIM_CASES.length;
}

const BLOCK = /`([^`]+)`\s*\.\.\s*`([^`]+)`/g;

/**
 * The blocks profile `digest_exclude` names, in order, as [{ start, end }] - core's format
 * (git-verify-pr > Digests): a backticked start marker, `..`, a backticked end marker, blocks separated
 * by `;`, or `none`. `operator_config` `digestExclude`, while a configuration still sets it, must name the
 * same blocks in the same order: a difference throws naming both, so the two never disagree silently.
 */
export function digestExclusions(profileValue, config = {}) {
  const value = String(profileValue ?? 'none').trim();
  const blocks = [...value.matchAll(BLOCK)].map(([, start, end]) => ({ start, end }));
  if (blocks.length === 0 && !/^none\b/.test(value)) throw new Error(`profile digest_exclude names no block and is not none: ${value}`);
  if (config.digestExclude !== undefined) {
    const configured = (config.digestExclude ?? []).map(({ start, end }) => ({ start, end }));
    if (JSON.stringify(configured) !== JSON.stringify(blocks)) {
      throw new Error(`profile digest_exclude and operator_config digestExclude name different blocks: ${JSON.stringify(blocks)} and ${JSON.stringify(configured)}`);
    }
  }
  return blocks;
}
