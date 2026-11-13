import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE_CLAIM_CASES, assertStaleClaims, digestExclusions, issueCandidates, issueCleanup } from './discovery-contract.mjs';

// The rule as discovery-contract.md > Stale claims states it: the record's job is neither queued nor
// running, whatever its subject, and the label was not applied after the record was written.
const contract = ({ claimed, record, labeledAt, jobs }) => {
  if (!claimed || !record?.job) return null;
  if (labeledAt && Date.parse(labeledAt) > Date.parse(record.at)) return null;
  return jobs.some((job) => job.id === record.job) ? null : record.job;
};

test('every stale-claim case names its input and the answer the contract requires', () => {
  for (const { name, input, stale } of STALE_CLAIM_CASES) {
    assert.equal(typeof name, 'string');
    assert.equal(typeof input.claimed, 'boolean');
    assert.ok(Array.isArray(input.jobs));
    assert.ok(stale === null || typeof stale === 'string');
  }
  assert.equal(assertStaleClaims(contract), STALE_CLAIM_CASES.length);
});

test('a discovery that judges a job live only under its pull request subject fails the clarification case by name', () => {
  const bySubject = (input) => contract({ ...input, jobs: input.jobs.filter((job) => job.subject.startsWith('pr-')) });
  assert.throws(() => assertStaleClaims(bySubject), /whatever its subject: a clarification select run/);
});

test('digest_exclude lists its blocks in order, and none lists nothing', () => {
  assert.deepEqual(digestExclusions('none'), []);
  assert.deepEqual(digestExclusions(undefined), []);
  const two = '`<!-- ci-status:start -->` .. `<!-- ci-status:end -->`; `<!-- SUMMARY -->` .. `<!-- /SUMMARY -->`';
  const blocks = [{ start: '<!-- ci-status:start -->', end: '<!-- ci-status:end -->' }, { start: '<!-- SUMMARY -->', end: '<!-- /SUMMARY -->' }];
  assert.deepEqual(digestExclusions(two), blocks);
  // Text after the blocks, a lone backticked word included, adds no block.
  assert.deepEqual(digestExclusions(`${two}   (kept equal to \`digestExclude\`)`), blocks);
  assert.throws(() => digestExclusions('ci status block'), /names no block and is not none/);
});

test('operator_config digestExclude must name the same blocks as digest_exclude, in the same order', () => {
  const two = '`<!-- a -->` .. `<!-- /a -->`; `<!-- b -->` .. `<!-- /b -->`';
  const a = { start: '<!-- a -->', end: '<!-- /a -->' };
  const b = { start: '<!-- b -->', end: '<!-- /b -->' };
  assert.deepEqual(digestExclusions(two, { digestExclude: [a, b] }), [a, b]);
  assert.deepEqual(digestExclusions(two, {}), [a, b]);
  assert.throws(() => digestExclusions(two, { digestExclude: [b, a] }), /name different blocks/);
  assert.throws(() => digestExclusions(two, { digestExclude: [a] }), /name different blocks/);
  assert.throws(() => digestExclusions('none', { digestExclude: [a] }), /name different blocks/);
  assert.deepEqual(digestExclusions('none', { digestExclude: [] }), []);
});

test('a queue issue is a candidate only while trusted and closed by no open or merged pull request', () => {
  const issue = (number, fields = {}) => ({ number, trusted: true, closingPrs: [], ...fields });
  const issues = [
    issue(1),
    issue(2, { trusted: false }),
    issue(3, { closingPrs: [{ number: 30, state: 'open' }] }),
    issue(4, { closingPrs: [{ number: 31, state: 'merged' }] }),
    // A closed attempt does not hold the issue: a rejection leaves it eligible.
    issue(5, { closingPrs: [{ number: 32, state: 'closed' }] }),
    issue(6),
  ];
  assert.deepEqual(issueCandidates(issues, [{ number: 33, closes: [6] }]).map((item) => item.number), [1, 5]);
  assert.deepEqual(issueCandidates([], []), []);
  // An open issue a merged pull request closes is never taken again, but it is cleaned up.
  assert.deepEqual(issueCleanup(issues.map((item) => ({ state: 'open', ...item }))).map((item) => item.number), [4]);
  assert.deepEqual(issueCleanup([issue(7, { state: 'closed', closingPrs: [{ number: 34, state: 'merged' }] })]), []);
  // A body edited at or after the merge is no evidence of what the merge closed.
  assert.deepEqual(issueCleanup([issue(8, { state: 'open', closingPrs: [{ number: 35, state: 'merged', editedAfterMerge: true }] })]), []);
});
