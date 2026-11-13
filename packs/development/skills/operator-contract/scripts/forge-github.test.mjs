import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorRole, checkOperatorConfig, checks, ciFromRuns, claim, closeIssue, closesOf, CLOSING_SEARCH_CAP, closingPullRequests, comment, commentIssue, createPr, draftPr, editPr, events, execute, factor, FLAGS, gh, isRead, issueTrust, listIssues, listPrs, merge, normalizeIssue, normalizePr, notes, prBody, prFiles, readInlineReviews, readPullRequests, readRole, readUnresolvedThreads, readyPr, repositoryOf, resolveThread, threads, UsageError, viewIssue, viewPr } from './forge-github.mjs';
import { issueCandidates, issueCleanup } from './discovery-contract.mjs';
import { assertShape } from './forge-contract.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'forge-github.mjs');
// The operator configuration every call that needs one reads; the CLI runs below inherit it.
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'forge-config-'));
process.env.OPERATOR_CONFIG = join(CONFIG_DIR, 'operator.json');
// The pack's example configuration, with the CI workflows these tests read.
const EXAMPLE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../references/operator-config.example.json'), 'utf8'));
writeFileSync(process.env.OPERATOR_CONFIG, JSON.stringify({ ...EXAMPLE, ciWorkflows: ['build', 'preview'] }));
process.on('exit', () => rmSync(CONFIG_DIR, { recursive: true, force: true }));
const RAW = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'T', body: 'B', isDraft: true, state: 'OPEN', headRefName: 'feature/slot-a-x', headRefOid: 'abc1234def',
  baseRefName: 'develop', mergeable: 'CONFLICTING', labels: [{ name: 'ai:processing' }], milestone: { title: 'Development' }, createdAt: '2026-10-30T08:00:00Z', author: { login: 'me' },
};

/** A gh stand-in that records every call and answers by the subcommand it was given. */
function fake(answers = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    for (const [prefix, answer] of Object.entries(answers)) if (args.join(' ').startsWith(prefix)) return typeof answer === 'function' ? answer(args) : answer;
    return '';
  };
  return { run, calls };
}

// No test can reach the real gh, or the repository it would act on, on any platform. Every command line below
// runs with a stand-in preloaded into the script's process, which answers every gh call with FORGE_GH_ANSWER; this
// process and those command lines see a PATH that holds only the stand-in's folder, so a gh call nothing caught
// finds no gh at all and fails.
const STAND_IN = mkdtempSync(join(tmpdir(), 'forge-gh-'));
process.env.PATH = STAND_IN;
const STAND_IN_MODULE = join(STAND_IN, 'gh-stand-in.cjs');
writeFileSync(STAND_IN_MODULE, [
  "const childProcess = require('node:child_process');",
  "childProcess.execFileSync = (file) => { if (file !== 'gh') throw new Error(`stand-in: unexpected ${file}`); return process.env.FORGE_GH_ANSWER ?? ''; };",
  "require('node:module').syncBuiltinESMExports();",
].join('\n'));
process.on('exit', () => rmSync(STAND_IN, { recursive: true, force: true }));

/** The script's command line, run against the gh stand-in: `answer` is what every gh call prints. */
function cli(args, { env = process.env, answer = '' } = {}) {
  const isolated = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return spawnSync(process.execPath, ['--require', STAND_IN_MODULE, SCRIPT, ...args], {
    encoding: 'utf8', cwd: STAND_IN, env: { ...isolated, PATH: STAND_IN, FORGE_GH_ANSWER: answer },
  });
}

test('a pull request is normalized to the contract shape', () => {
  assert.deepEqual(normalizePr(RAW), {
    number: 7, url: RAW.url, title: 'T', body: 'B', draft: true, state: 'open', head: { ref: 'feature/slot-a-x', sha: 'abc1234def' }, base: { ref: 'develop' },
    mergeable: 'conflicting', labels: ['ai:processing'], milestone: 'Development', createdAt: RAW.createdAt, author: 'me', closes: [],
  });
  assert.equal(normalizePr({ ...RAW, mergeable: 'UNKNOWN', milestone: null }).mergeable, 'unknown');
  assert.equal(normalizePr({ ...RAW, mergeable: 'MERGEABLE' }).mergeable, 'clean');
  const { run, calls } = fake({ 'pr view 7': JSON.stringify(RAW) });
  assert.equal(viewPr(7, run).milestone, 'Development');
  assert.ok(calls[0].includes('--json'));
});

test('checks judge only the deciding workflows, exactly as discovery does', () => {
  const runs = [
    { databaseId: 1, workflowName: 'build', attempt: 1, status: 'completed', conclusion: 'failure', createdAt: '2026-10-30T08:00:00Z', url: 'u1' },
    { databaseId: 2, workflowName: 'build', attempt: 2, status: 'completed', conclusion: 'success', createdAt: '2026-10-30T09:00:00Z', url: 'u2' },
    { databaseId: 3, workflowName: 'preview', attempt: 1, status: 'completed', conclusion: 'skipped', createdAt: '2026-10-30T08:00:00Z', url: 'u3' },
    // A helper workflow a label event cancelled is not a red build.
    { databaseId: 4, workflowName: 'cleanup', attempt: 1, status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-30T09:30:00Z', url: 'u4' },
  ];
  const config = { ciWorkflows: ['build', 'preview'] };
  const read = (list) => fake({ 'run list': JSON.stringify(list) }).run;
  assert.deepEqual(checks('abc1234', read(runs), config), { sha: 'abc1234', state: 'success', runs: [{ name: 'build', state: 'success', url: 'u2' }, { name: 'preview', state: 'success', url: 'u3' }] });
  const fixtures = [
    runs,
    [...runs, { databaseId: 5, workflowName: 'preview', attempt: 1, status: 'in_progress', createdAt: '2026-10-30T10:00:00Z', url: 'u5' }],
    [...runs, { databaseId: 6, workflowName: 'build', attempt: 3, status: 'completed', conclusion: 'timed_out', createdAt: '2026-10-30T10:00:00Z', url: 'u6' }],
    [runs[3]],
  ];
  // The answer skills read and the state discovery keys requests on are one judgement.
  for (const list of fixtures) assert.equal(checks('abc1234', read(list), config).state, ciFromRuns(list, config));
  assert.deepEqual(fixtures.map((list) => ciFromRuns(list, config)), ['success', 'pending', 'failure', 'none']);
  const { run, calls } = fake({ 'run list': JSON.stringify(runs) });
  checks('abc1234', run, config);
  assert.deepEqual(calls[0].slice(0, 4), ['run', 'list', '--commit', 'abc1234']);
  assert.throws(() => checks('not-a-sha', run), /commit sha/);
});

test('threads are read on every page, filtered to unresolved on request, and resolved with a reply', () => {
  const node = (id, resolved) => JSON.stringify({ id, isResolved: resolved, path: 'a.ts', line: 3, comments: { nodes: [{ author: { login: 'r' }, body: 'fix', createdAt: 't' }] } });
  const { run, calls } = fake({ 'api graphql --paginate': `${node('T1', false)}\n${node('T2', true)}\n` });
  assert.deepEqual(threads(7, {}, run).map((thread) => [thread.id, thread.resolved]), [['T1', false], ['T2', true]]);
  assert.deepEqual(threads(7, { unresolved: true }, run).map((thread) => thread.id), ['T1']);
  assert.deepEqual(threads(7, {}, run)[0].comments, [{ author: 'r', body: 'fix', createdAt: 't' }]);
  assert.ok(calls[0].some((arg) => arg.includes('$endCursor') && arg.includes('pageInfo')));
  const write = fake();
  assert.deepEqual(resolveThread('T1', 'Fixed in abc1234.', write.run), { id: 'T1', resolved: true, changed: true });
  assert.equal(write.calls.length, 3);
  assert.ok(write.calls[1].some((arg) => arg.includes('addPullRequestReviewThreadReply')));
  assert.ok(write.calls[2].some((arg) => arg.includes('resolveReviewThread')));
  // A retry finds the thread resolved and posts no second reply.
  const again = fake({ 'api graphql -f query=query': 'true\n' });
  assert.deepEqual(resolveThread('T1', 'Fixed in abc1234.', again.run), { id: 'T1', resolved: true, changed: false });
  assert.equal(again.calls.length, 1);
  assert.throws(() => resolveThread('T1', ' ', write.run), /--body/);
});

test('a claim is the processing label: take refuses one already standing as held, release drops it', () => {
  const held = fake({ 'pr view 7': JSON.stringify(RAW) });
  assert.deepEqual(claim('take', 7, held.run), { pr: 7, claimed: false, held: true });
  assert.equal(held.calls.some((args) => args[1] === 'edit'), false);
  assert.deepEqual(claim('release', 7, held.run), { pr: 7, claimed: false, changed: true });
  assert.deepEqual(held.calls.at(-1), ['pr', 'edit', '7', '--remove-label', 'ai:processing']);
  const free = fake({ 'pr view 7': JSON.stringify({ ...RAW, labels: [] }) });
  assert.deepEqual(claim('take', 7, free.run), { pr: 7, claimed: true, changed: true });
  assert.deepEqual(free.calls.at(-1), ['pr', 'edit', '7', '--add-label', 'ai:processing']);
  assert.deepEqual(claim('release', 7, free.run), { pr: 7, claimed: false, changed: false });
  assert.throws(() => claim('steal', 7, free.run), /take or release/);
});

test('a hand-off edits milestone and labels in one call; factors, comments and merges map to one gh call each', () => {
  const edit = fake({ 'pr view 7': JSON.stringify(RAW) });
  editPr(7, { milestone: 'Verification', add: ['x'], remove: ['ai:processing'] }, edit.run);
  assert.deepEqual(edit.calls[0], ['pr', 'edit', '7', '--milestone', 'Verification', '--add-label', 'x', '--remove-label', 'ai:processing']);
  assert.throws(() => editPr(7, {}, edit.run), /needs --claim, --milestone/);
  const set = fake();
  assert.deepEqual(factor('set', 7, 'ai:reviewed', set.run), { pr: 7, factor: 'ai:reviewed', set: true });
  assert.deepEqual(set.calls[0], ['pr', 'edit', '7', '--add-label', 'ai:reviewed']);
  // The claim label is never a factor: setting it there would claim around the session gate.
  assert.throws(() => factor('set', 7, 'ai:processing', set.run), /is the claim, not a factor/);
  assert.equal(set.calls.length, 1);
  const posted = fake({ 'pr comment 7': 'https://github.com/o/r/pull/7#issuecomment-1\n' });
  assert.deepEqual(comment(7, '/tmp/body.md', posted.run), { pr: 7, url: 'https://github.com/o/r/pull/7#issuecomment-1' });
  const merged = fake({ 'pr view 7': JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'm1' } }) });
  assert.deepEqual(merge(7, 'squash', merged.run), { pr: 7, state: 'merged', mergeCommit: 'm1' });
  assert.deepEqual(merged.calls[0], ['pr', 'merge', '7', '--squash']);
  assert.equal(merged.calls[0].includes('--admin'), false);
  assert.throws(() => merge(7, 'force', merged.run), /--method/);
});

test('the body and the label events read the same fields discovery does', () => {
  const body = fake({ 'pr view 7': JSON.stringify({ body: 'steps' }) });
  assert.equal(prBody(7, body.run), 'steps');
  const raw = [{ id: 9, event: 'labeled', created_at: 't', label: { name: 'owner:accepted' } }].map((event) => JSON.stringify(event)).join('\n');
  const listed = fake({ 'api --paginate': raw });
  assert.deepEqual(events(7, listed.run), [{ id: 9, event: 'labeled', label: 'owner:accepted', createdAt: 't' }]);
});

test('the command line refuses an unknown subcommand and a missing number', () => {
  assert.throws(() => execute(['nope']), /usage: forge-github/);
  assert.throws(() => execute(['pr', 'view', 'x'], fake().run), /number is required/);
  const usage = cli(['nope']);
  // A command line the script cannot act on is a usage error: exit 2, apart from a gh failure (1).
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: forge-github/);
});

test('empty inline reviews get their comment bodies from one query per PR', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return [JSON.stringify({ id: 'r1', bodies: ['Fixed.\n<!-- operator:note -->'] }), JSON.stringify({ id: 'r2', bodies: ['Rename it.'] })].join('\n');
  };
  const prs = [
    { number: 1, reviews: [{ id: 'r1', body: '', state: 'COMMENTED' }, { id: 'r2', body: ' ', state: 'COMMENTED' }, { id: 'r3', body: 'Text', state: 'COMMENTED' }, { id: 'r4', body: '', state: 'APPROVED' }] },
    { number: 2, reviews: [{ id: 'r5', body: 'Looks fine', state: 'COMMENTED' }] },
  ];
  readInlineReviews(prs, run);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter((arg) => arg.startsWith('ids[]=')), ['ids[]=r1', 'ids[]=r2']);
  assert.deepEqual(prs[0].reviews.map((review) => review.inline), [['Fixed.\n<!-- operator:note -->'], ['Rename it.'], undefined, undefined]);
});

test('unresolved review threads are counted across every page', () => {
  let args = null;
  // gh --paginate prints one line per unresolved thread of every page.
  const run = (given) => { args = given; return '1\n1\n1\n'; };
  assert.equal(readUnresolvedThreads(7, run), 3);
  assert.ok(args.includes('--paginate'));
  assert.ok(args.some((arg) => arg.includes('$endCursor') && arg.includes('pageInfo')));
  assert.equal(readUnresolvedThreads(7, () => ''), 0);
});

test('listing, creating and readying a pull request answer it in the contract shape', () => {
  const { run, calls } = fake({ 'pr list': JSON.stringify([RAW]), 'pr view 7': JSON.stringify(RAW), 'pr create': 'Creating...\nhttps://github.com/o/r/pull/7\n' });
  assert.deepEqual(listPrs(run).map((pr) => pr.head.sha), ['abc1234def']);
  assert.deepEqual(calls[0].slice(0, 4), ['pr', 'list', '--state', 'open']);
  assert.equal(createPr({ base: 'develop', head: 'feature/slot-a-x', title: 'T', bodyFile: 'b.md', draft: true }, run).number, 7);
  assert.deepEqual(calls.find((args) => args[1] === 'create'), ['pr', 'create', '--base', 'develop', '--head', 'feature/slot-a-x', '--title', 'T', '--body-file', 'b.md', '--draft']);
  assert.throws(() => createPr({ base: 'develop' }, run), /needs --base, --head, --title and --body-file/);
  assert.equal(readyPr(7, run).draft, true);
  assert.ok(calls.some((args) => args.join(' ') === 'pr ready 7'));
  const files = fake({ 'pr view 7': JSON.stringify({ files: [{ path: 'a.ts' }, { path: 'b.md' }] }) });
  assert.deepEqual(prFiles(7, files.run), { pr: 7, files: ['a.ts', 'b.md'] });
});

test('notes carry the conversation in time order, author roles and inline review bodies', () => {
  const conversation = {
    number: 7,
    comments: [{ id: 'c2', author: { login: 'owner' }, authorAssociation: 'OWNER', body: 'Rename it.', createdAt: '2026-10-30T09:00:00Z', url: 'u-c2' }],
    reviews: [
      { id: 'r1', author: { login: 'bot' }, authorAssociation: 'NONE', body: 'x', state: 'COMMENTED', submittedAt: '2026-10-30T08:00:00Z' },
      { id: 'r3', author: { login: 'dev' }, authorAssociation: 'COLLABORATOR', body: '', state: 'COMMENTED', submittedAt: '2026-10-30T10:00:00Z' },
    ],
  };
  const { run } = fake({ 'pr view 7': JSON.stringify(conversation), 'api graphql': JSON.stringify({ id: 'r3', bodies: ['Inline remark.'] }) });
  const listed = notes(7, run);
  assert.deepEqual(listed.map((note) => [note.id, note.kind, note.authorRole]), [['r1', 'review', 'other'], ['c2', 'comment', 'owner'], ['r3', 'review', 'member']]);
  assert.equal(listed[0].state, 'commented');
  assert.deepEqual(listed[2].inline, ['Inline remark.']);
  assert.equal('state' in listed[1], false);
});

test('the command line dispatches every subcommand to its function', () => {
  const answers = { 'pr list': JSON.stringify([RAW]), 'pr view 7': JSON.stringify({ ...RAW, files: [{ path: 'a.ts' }], comments: [], reviews: [], state: 'MERGED', mergeCommit: { oid: 'm' } }), 'run list': '[]', 'api graphql': '', 'api --paginate': '', 'pr comment 7': 'https://github.com/o/r/pull/7#issuecomment-1' };
  const run = fake(answers).run;
  assert.equal(execute(['pr', 'list'], run).length, 1);
  assert.equal(execute(['pr', 'view', '7'], run).number, 7);
  assert.equal(execute(['pr', 'ready', '7'], run).number, 7);
  assert.equal(execute(['pr', 'draft', '7'], run).number, 7);
  assert.equal(execute(['pr', 'edit', '7', '--milestone', 'Verification'], run).number, 7);
  assert.equal(typeof execute(['pr', 'body', '7'], run).text, 'string');
  assert.deepEqual(execute(['pr', 'files', '7'], run).files, ['a.ts']);
  assert.equal(execute(['checks', 'abc1234'], run).state, 'none');
  assert.deepEqual(execute(['threads', '7'], run), []);
  assert.equal(execute(['claim', 'take', '7'], run).held, true);
  assert.equal(execute(['factor', 'clear', '7', '--name', 'ai:reviewed'], run).set, false);
  assert.equal(execute(['comment', '7', '--body-file', 'b.md'], run).url, 'https://github.com/o/r/pull/7#issuecomment-1');
  assert.deepEqual(execute(['notes', '7'], run), []);
  assert.deepEqual(execute(['events', '7'], run), []);
  assert.equal(execute(['merge', '7', '--method', 'squash'], run).state, 'merged');
});

test('the CLI prints a body as plain text and answers a held claim with exit 3', () => {
  // Every view answers the same pull request, held by the processing label.
  const answer = JSON.stringify({ ...RAW, body: 'Plain body text' });
  const body = cli(['pr', 'body', '7'], { answer });
  assert.equal(body.status, 0, body.stderr);
  assert.equal(body.stdout, 'Plain body text');
  const take = cli(['claim', 'take', '7'], { answer });
  assert.equal(take.status, 3, take.stderr);
  assert.deepEqual(JSON.parse(take.stdout), { pr: 7, claimed: false, held: true });
});

test('a claim edit takes the label with the milestone move in one call, or answers held and edits nothing', () => {
  const free = fake({ 'pr view 7': JSON.stringify({ ...RAW, labels: [] }) });
  editPr(7, { claim: true, milestone: 'Verification', remove: ['ai:completed'] }, free.run);
  assert.deepEqual(free.calls.filter((args) => args[1] === 'edit'), [['pr', 'edit', '7', '--milestone', 'Verification', '--add-label', 'ai:processing', '--remove-label', 'ai:completed']]);
  const held = fake({ 'pr view 7': JSON.stringify(RAW) });
  assert.deepEqual(editPr(7, { claim: true, milestone: 'Verification' }, held.run), { pr: 7, claimed: false, held: true });
  assert.equal(held.calls.some((args) => args[1] === 'edit'), false);
  // The claim label is only ever added through the held check.
  assert.throws(() => editPr(7, { add: ['ai:processing'] }, free.run), /is the claim: use pr edit --claim/);
});

test('author roles follow operator_config allowedAuthors, the list discovery reads', () => {
  const config = { allowedAuthors: ['OWNER', 'MEMBER'] };
  assert.deepEqual(['OWNER', 'MEMBER', 'COLLABORATOR', 'NONE'].map((association) => authorRole(association, config)), ['owner', 'member', 'other', 'other']);
  assert.deepEqual(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].map((association) => authorRole(association)), ['owner', 'member', 'member', 'other']);
  const { run } = fake({ 'pr view 7': JSON.stringify({ number: 7, comments: [{ id: 'c1', authorAssociation: 'COLLABORATOR', body: 'x', createdAt: 't' }], reviews: [] }) });
  assert.equal(notes(7, run, config)[0].authorRole, 'other');
});

test('an option without a real value is a usage error, never a silent default', () => {
  const run = fake({ 'api graphql': '' }).run;
  assert.throws(() => execute(['threads', '7', '--resolve'], run), /--resolve needs a value/);
  assert.throws(() => execute(['threads', '7', '--resolve', ''], run), /--resolve needs a value/);
  assert.throws(() => execute(['threads', '7', '--resolve', '--body', 'x'], run), /--resolve needs a value/);
  assert.throws(() => execute(['pr', 'edit', '7', '--milestone'], run), /--milestone needs a value/);
  assert.throws(() => execute(['comment', '7', '--body-file', '--draft'], run), /--body-file needs a value/);
  assert.throws(() => execute(['merge', '7', '--method'], run), /--method needs a value/);
  const usage = cli(['threads', '7', '--resolve']);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /--resolve needs a value/);
});

test('a takeover takes a standing claim the contract allows, and only with --claim', () => {
  const held = fake({ 'pr view 7': JSON.stringify(RAW) });
  assert.deepEqual(claim('take', 7, held.run, { takeover: true }), { pr: 7, claimed: true, changed: false, takenOver: true });
  editPr(7, { claim: true, takeover: true, milestone: 'Development', remove: ['ai:completed'] }, held.run);
  // The label already stands, so the edit moves the milestone and adds nothing.
  assert.deepEqual(held.calls.filter((args) => args[1] === 'edit'), [['pr', 'edit', '7', '--milestone', 'Development', '--remove-label', 'ai:completed']]);
  assert.deepEqual(editPr(7, { claim: true, takeover: true }, held.run), { pr: 7, claimed: true, changed: false, takenOver: true });
  assert.throws(() => editPr(7, { takeover: true, milestone: 'Development' }, held.run), /--takeover goes with --claim/);
  assert.equal(execute(['claim', 'take', '7', '--takeover'], held.run).takenOver, true);
});

test('a value that merely starts with dashes is a value; only a flag of this script is missing one', () => {
  const posted = fake({ 'pr comment 7': 'https://github.com/o/r/pull/7#issuecomment-1' });
  assert.equal(execute(['comment', '7', '--body-file', '--draft.md'], posted.run).pr, 7);
  const edit = fake({ 'pr view 7': JSON.stringify(RAW) });
  execute(['pr', 'edit', '7', '--milestone', '-- later'], edit.run);
  assert.deepEqual(edit.calls[0], ['pr', 'edit', '7', '--milestone', '-- later']);
  assert.throws(() => execute(['pr', 'edit', '7', '--milestone', '--remove-label', 'x'], edit.run), /--milestone needs a value/);
});

test('only claim take accepts --takeover', () => {
  const run = fake({ 'pr view 7': JSON.stringify(RAW) }).run;
  assert.throws(() => claim('release', 7, run, { takeover: true }), /--takeover goes with claim take/);
  assert.throws(() => execute(['claim', 'release', '7', '--takeover'], run), /--takeover goes with claim take/);
});

test('every option the command line reads is a known flag, so a missing value is never taken for another option', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const body = source.slice(source.indexOf('export function execute('));
  const used = new Set([...body.matchAll(/(?:option|options)\(args, '(--[a-z-]+)'\)|args\.includes\('(--[a-z-]+)'\)/g)].map((match) => match[1] ?? match[2]));
  assert.ok(used.size >= 10, `found only ${[...used].join(', ')}`);
  assert.deepEqual([...used].filter((flag) => !FLAGS.has(flag)), []);
});

test('every answer holds the forge contract shape the development pack checks', () => {
  const thread = JSON.stringify({ id: 'T1', isResolved: false, path: 'a.ts', line: 3, comments: { nodes: [{ author: { login: 'r' }, body: 'fix', createdAt: 't' }] } });
  const conversation = { number: 7, comments: [{ id: 'c1', author: { login: 'o' }, authorAssociation: 'OWNER', body: 'x', createdAt: 't', url: 'u' }], reviews: [] };
  const answers = {
    'pr list': JSON.stringify([RAW]),
    'pr view 7 --json number,comments,reviews': JSON.stringify(conversation),
    'pr view 7 --json files': JSON.stringify({ files: [{ path: 'a.ts' }] }),
    'pr view 7 --json state,mergeCommit': JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'm' } }),
    'pr view 7': JSON.stringify(RAW),
    'run list': JSON.stringify([{ databaseId: 1, workflowName: 'build', attempt: 1, status: 'completed', conclusion: 'success', createdAt: 't', url: 'u' }]),
    'api graphql --paginate': `${thread}\n`,
    'api --paginate': JSON.stringify({ id: 9, event: 'labeled', created_at: 't', label: { name: 'l' } }),
    'pr comment 7': 'https://github.com/o/r/pull/7#issuecomment-1',
  };
  const run = fake(answers).run;
  for (const pr of execute(['pr', 'list'], run)) assertShape('pr', pr);
  assertShape('pr', execute(['pr', 'view', '7'], run));
  assertShape('files', execute(['pr', 'files', '7'], run));
  assertShape('checks', execute(['checks', 'abc1234'], run));
  for (const item of execute(['threads', '7'], run)) assertShape('thread', item);
  for (const item of execute(['notes', '7'], run)) assertShape('note', item);
  for (const item of execute(['events', '7'], run)) assertShape('event', item);
  assertShape('claim', execute(['claim', 'take', '7'], run));
  assertShape('factor', execute(['factor', 'set', '7', '--name', 'ai:reviewed'], run));
  assertShape('comment', execute(['comment', '7', '--body-file', 'b.md'], run));
  assertShape('merge', execute(['merge', '7', '--method', 'squash'], run));
});

test('without an operator configuration the script refuses with a usage error', () => {
  const env = { ...process.env };
  delete env.OPERATOR_CONFIG;
  const usage = cli(['claim', 'take', '7'], { env });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /OPERATOR_CONFIG/);
});

test('the example configuration is complete, and a missing required key is refused by name', () => {
  assert.equal(checkOperatorConfig(EXAMPLE), EXAMPLE);
  const without = (mutate) => { const copy = structuredClone(EXAMPLE); mutate(copy); return copy; };
  assert.throws(() => checkOperatorConfig(without((c) => delete c.labels.processing)), /missing required key labels\.processing/);
  assert.throws(() => checkOperatorConfig(without((c) => delete c.milestones.mergeQueue)), /missing required key milestones\.mergeQueue/);
  assert.throws(() => checkOperatorConfig(without((c) => delete c.milestones.codeReview)), /missing required key milestones\.codeReview/);
  assert.throws(() => checkOperatorConfig(without((c) => delete c.milestones.clarification)), /missing required key milestones\.clarification/);
  assert.throws(() => checkOperatorConfig(without((c) => { c.slots = []; })), /missing required key slots/);
  const path = join(CONFIG_DIR, 'incomplete.json');
  writeFileSync(path, JSON.stringify(without((c) => delete c.allowedAuthors)));
  const usage = cli(['claim', 'take', '7'], { env: { ...process.env, OPERATOR_CONFIG: path } });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /missing required key allowedAuthors/);
});

test('a pull request at the list cap has its whole conversation read, others keep the list answer', () => {
  const at = (n) => Array.from({ length: n }, (_, i) => ({ body: `c${i}`, createdAt: `2026-10-30T08:${String(i % 60).padStart(2, '0')}:00Z` }));
  const { run, calls } = fake({
    'pr list': JSON.stringify([{ number: 7, comments: at(100), reviews: [] }, { number: 8, comments: at(3), reviews: [] }]),
    'pr view 7': JSON.stringify({ comments: at(106), reviews: [{ body: 'r' }] }),
  });
  const prs = readPullRequests(run);
  assert.equal(prs[0].comments.length, 106);
  assert.equal(prs[0].reviews.length, 1);
  assert.equal(prs[1].comments.length, 3);
  assert.deepEqual(calls.filter((args) => args[1] === 'view').map((args) => args[2]), ['7']);
});

test('a pull request goes back to draft in one call and answers in the contract shape', () => {
  const { run, calls } = fake({ 'pr view 7': JSON.stringify(RAW) });
  assertShape('pr', draftPr(7, run));
  assert.deepEqual(calls[0], ['pr', 'ready', '7', '--undo']);
});

test('renaming a head branch is not offered: the platform closes a pull request whose head branch is renamed', () => {
  const renamed = fake({ 'pr view 7': JSON.stringify(RAW) });
  assert.throws(() => execute(['branch', 'rename', '7', '--to', 'feature/slot-a-x'], renamed.run), UsageError);
  assert.deepEqual(renamed.calls, []);
});

test('the discovery reader lists whether each head lives on a fork', () => {
  const { run, calls } = fake({ 'pr list': JSON.stringify([{ number: 7, isCrossRepository: true, comments: [], reviews: [] }]) });
  assert.equal(readPullRequests(run)[0].isCrossRepository, true);
  assert.ok(calls[0].at(-1).split(',').includes('isCrossRepository'));
});

test('an edit replaces the title and the body, alone or in the same call as the hand-off and the claim', () => {
  const alone = fake({ 'pr view 7': JSON.stringify(RAW) });
  execute(['pr', 'edit', '7', '--title', 'Added the export', '--body-file', 'b.md'], alone.run);
  assert.deepEqual(alone.calls.filter((args) => args[1] === 'edit'), [['pr', 'edit', '7', '--title', 'Added the export', '--body-file', 'b.md']]);
  const handoff = fake({ 'pr view 7': JSON.stringify(RAW) });
  execute(['pr', 'edit', '7', '--milestone', 'Verification', '--remove-label', 'ai:processing', '--title', 'Added the export'], handoff.run);
  assert.deepEqual(handoff.calls.filter((args) => args[1] === 'edit'), [['pr', 'edit', '7', '--milestone', 'Verification', '--title', 'Added the export', '--remove-label', 'ai:processing']]);
  // The claim check comes first: a held pull request keeps its title and body.
  const held = fake({ 'pr view 7': JSON.stringify(RAW) });
  assert.deepEqual(execute(['pr', 'edit', '7', '--claim', '--title', 'X', '--body-file', 'b.md'], held.run), { pr: 7, claimed: false, held: true });
  assert.equal(held.calls.some((args) => args[1] === 'edit'), false);
  const free = fake({ 'pr view 7': JSON.stringify({ ...RAW, labels: [] }) });
  execute(['pr', 'edit', '7', '--claim', '--milestone', 'Development', '--body-file', 'b.md'], free.run);
  assert.deepEqual(free.calls.filter((args) => args[1] === 'edit'), [['pr', 'edit', '7', '--milestone', 'Development', '--body-file', 'b.md', '--add-label', 'ai:processing']]);
  assert.throws(() => execute(['pr', 'edit', '7', '--title'], free.run), /--title needs a value/);
});

test('a flag the subcommand does not read is a usage error, never silently ignored', () => {
  const run = fake({ 'pr view 7': JSON.stringify(RAW), 'pr comment 7': 'https://github.com/o/r/pull/7#issuecomment-1' }).run;
  assert.throws(() => execute(['pr', 'edit', '7', '--milestone', 'Verification', '--titel', 'x'], run), /pr edit does not take --titel/);
  assert.throws(() => execute(['pr', 'edit', '7', '--draft'], run), /pr edit does not take --draft/);
  assert.throws(() => execute(['comment', '7', '--body-file', 'b.md', '--title', 'x'], run), /comment does not take --title/);
  assert.throws(() => execute(['pr', 'view', '7', '--claim'], run), /pr view does not take --claim/);
  // A value that starts with dashes is still the value of the flag before it.
  assert.equal(execute(['comment', '7', '--body-file', '--titel.md'], run).pr, 7);
  const usage = cli(['pr', 'edit', '7', '--milestone', 'Verification', '--titel', 'x']);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /does not take --titel/);
});

test('gh asks a read again after a network fault, and never repeats a write', () => {
  const fault = (stderr) => Object.assign(new Error('Command failed'), { stderr });
  const flaky = (failures, stderr) => {
    const calls = [];
    return { calls, exec: (_bin, args) => { calls.push(args); if (calls.length <= failures) throw fault(stderr); return 'ok'; } };
  };
  const waits = [];
  const wait = (ms) => waits.push(ms);

  const read = flaky(2, 'read tcp: read: connection reset by peer\n');
  assert.equal(gh(['pr', 'list', '--json', 'number'], { exec: read.exec, wait }), 'ok');
  assert.equal(read.calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);

  const down = flaky(5, 'Post "https://api.github.com/graphql": net/http: TLS handshake timeout\n');
  assert.throws(() => gh(['api', 'graphql', '-f', 'query=query{viewer{login}}'], { exec: down.exec, wait }), /Command failed/);
  assert.equal(down.calls.length, 3);

  const write = flaky(1, 'read: connection reset by peer');
  assert.throws(() => gh(['pr', 'comment', '7', '--body-file', 'b.md'], { exec: write.exec, wait }));
  assert.equal(write.calls.length, 1);

  const answer = flaky(1, 'GraphQL: Could not resolve to a PullRequest');
  assert.throws(() => gh(['pr', 'view', '7'], { exec: answer.exec, wait }));
  assert.equal(answer.calls.length, 1);
});

test('isRead tells reads from writes', () => {
  for (const args of [['pr', 'list'], ['pr', 'view', '1'], ['run', 'list'], ['api', 'repos/{owner}/{repo}/issues/1/events'], ['api', 'graphql', '-f', 'query=query($id:ID!){node(id:$id){id}}']]) assert.equal(isRead(args), true, args.join(' '));
  for (const args of [['pr', 'edit', '1'], ['pr', 'comment', '1'], ['pr', 'merge', '1'], ['pr', 'ready', '1'], ['api', '-X', 'POST', 'x'], ['api', 'x', '-f', 'a=b'], ['api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}'], ['api', '--method=POST', 'x'], ['api', '-XPOST', 'x'], ['api', 'graphql', '-f', 'query=# reply\nmutation{x}']]) assert.equal(isRead(args), false, args.join(' '));
});

// Issues as a queue source.
const QUEUE = { ...EXAMPLE, issues: { label: 'pipeline:queue', source: 'Issues' } };
const labelled = (actor, createdAt = '2026-11-13T10:00:00Z') => ({ __typename: 'LabeledEvent', createdAt, label: { name: 'pipeline:queue' }, actor: { login: actor } });
const ISSUE = {
  number: 12, url: 'https://github.com/o/r/issues/12', title: 'Export fails', body: 'Steps', state: 'OPEN', stateReason: null, createdAt: '2026-11-13T09:00:00Z',
  lastEditedAt: null, authorAssociation: 'NONE', author: { login: 'stranger' }, labels: { nodes: [{ name: 'pipeline:queue' }] },
  closedByPullRequestsReferences: { nodes: [{ number: 30, state: 'MERGED' }] }, timelineItems: { nodes: [labelled('maintainer')] },
};
const ROLE = { maintainer: 'maintain', stranger: 'read', triager: 'triage' };
const roleOf = (login) => ROLE[login] ?? 'none';

test('a pull request body closes the issues a closing keyword names outside code, and no others', () => {
  assert.deepEqual(closesOf('Closes #12\nfixes: #3, resolved #40 and Fixed #3'), [3, 12, 40]);
  assert.deepEqual(closesOf('See #5. Enclosed #6. Closes other/repo#7. closes#8'), []);
  assert.deepEqual(normalizePr({ ...RAW, body: 'Resolves #9' }).closes, [9]);
  assert.deepEqual(closesOf(undefined), []);
  // The platform reads no reference in code or an HTML comment: a documented example closes nothing.
  const documented = ['Write `Closes #12` in the body.', '```', 'Fixes #13', '```', '~~~~md', 'resolves #14', '~~~', 'still code: closes #15', '~~~~', '<!-- Closes #16 -->', 'Closes #17'].join('\n');
  assert.deepEqual(closesOf(documented), [17]);
  // An unclosed fence runs to the end of the body.
  assert.deepEqual(closesOf('Closes #1\n```\nCloses #2'), [1]);
  // Indented code after a blank line closes nothing; an indented paragraph continuation or list content does.
  assert.deepEqual(closesOf('    Closes #1\n\n\tCloses #2'), []);
  assert.deepEqual(closesOf('text\n    Closes #3\n- item\n\n    Closes #4'), [3, 4]);
  // Code inside a list item is indented from the item's content, nested items included.
  assert.deepEqual(closesOf('- Example:\n\n      Closes #11\n\n  Closes #12'), [12]);
  assert.deepEqual(closesOf('1. item\n   - sub\n\n         Closes #13\n\n       Closes #14'), [14]);
  assert.deepEqual(closesOf('1.  item\n\n    ```\n    Closes #15\n    ```\nCloses #16'), [16]);
  // A paragraph back in the parent item after a nested one is prose; a fence may open on the marker line.
  assert.deepEqual(closesOf('1.  Summary\n    - Detail\n\n    Closes #18'), [18]);
  assert.deepEqual(closesOf('- ```text\n  Closes #19\n  ```\n\nCloses #20\n- Fixes #21'), [20, 21]);
  // Bodies written in a browser end their lines with CRLF.
  assert.deepEqual(closesOf('```\r\nexample\r\n```\r\nCloses #17'), [17]);
  // A backtick run with backticks after it on the line is a code span, not a fence that hides the rest.
  assert.deepEqual(closesOf('```example```\nCloses #5 ``a`b``'), [5]);
  // This repository's issues by qualified name or URL, never another repository's.
  assert.deepEqual(closesOf('Fixes o/r#6, closes https://github.com/o/r/issues/7, fixes other/r#8, closes https://github.com/other/r/issues/9', 'o/r'), [6, 7]);
  assert.deepEqual(closesOf('Fixes o/r#6'), []);
  assert.deepEqual(normalizePr({ ...RAW, url: 'https://github.com/o/r/pull/1', body: 'Fixes O/R#10' }).closes, [10]);
  assert.equal(repositoryOf('https://github.com/o/r/pull/1'), 'o/r');
  assert.equal(repositoryOf(undefined), null);
});

test('an issue is trusted only from a trusted author, or labelled by someone who can triage and not edited since', () => {
  assert.equal(issueTrust({ ...ISSUE, authorAssociation: 'OWNER', author: { login: 'me' } }, roleOf, QUEUE).trusted, true);
  assert.deepEqual(issueTrust(ISSUE, roleOf, QUEUE), { trusted: true, trust: 'pipeline:queue applied by maintainer' });
  // An issue template applies the label for its author: the label alone never trusts the text, and an
  // author the platform does not associate with the repository needs no role lookup to say so.
  const asked = [];
  const template = issueTrust({ ...ISSUE, timelineItems: { nodes: [labelled('stranger')] } }, (login) => { asked.push(login); return 'none'; }, QUEUE);
  assert.equal(template.trusted, false);
  assert.deepEqual(asked, []);
  assert.match(issueTrust({ ...ISSUE, timelineItems: { nodes: [] } }, roleOf, QUEUE).trust, /nobody who can triage/);
  // Text or title changed after the label: applying it again trusts the new text.
  assert.match(issueTrust({ ...ISSUE, lastEditedAt: '2026-11-13T11:00:00Z' }, roleOf, QUEUE).trust, /edited after maintainer/);
  const renamed = { ...ISSUE, timelineItems: { nodes: [labelled('maintainer'), { __typename: 'RenamedTitleEvent', createdAt: '2026-11-13T11:00:00Z' }] } };
  assert.equal(issueTrust(renamed, roleOf, QUEUE).trusted, false);
  // An edit in the same second as the label cannot be ordered against it, so it is after it; a rename the
  // timeline lists after the label is after it whatever its time says.
  assert.equal(issueTrust({ ...ISSUE, lastEditedAt: '2026-11-13T10:00:00Z' }, roleOf, QUEUE).trusted, false);
  const sameSecond = { ...ISSUE, timelineItems: { nodes: [{ __typename: 'RenamedTitleEvent', createdAt: '2026-11-13T10:00:00Z' }, labelled('maintainer')] } };
  assert.equal(issueTrust(sameSecond, roleOf, QUEUE).trusted, false);
  const listedAfter = { ...ISSUE, timelineItems: { nodes: [labelled('maintainer'), { __typename: 'RenamedTitleEvent', createdAt: '2026-11-13T09:59:59Z' }] } };
  assert.equal(issueTrust(listedAfter, roleOf, QUEUE).trusted, false);
  const renamedBefore = { ...ISSUE, timelineItems: { nodes: [{ __typename: 'RenamedTitleEvent', createdAt: '2026-11-13T09:30:00Z' }, labelled('maintainer')] } };
  assert.equal(issueTrust(renamedBefore, roleOf, QUEUE).trusted, true);
  const relabelled = { ...ISSUE, lastEditedAt: '2026-11-13T11:00:00Z', timelineItems: { nodes: [labelled('maintainer'), labelled('triager', '2026-11-13T12:00:00Z')] } };
  assert.equal(issueTrust(relabelled, roleOf, QUEUE).trusted, true);
  // The latest application decides: a stranger re-applying it after a trusted one does not keep the trust.
  const reapplied = { ...ISSUE, timelineItems: { nodes: [labelled('maintainer'), labelled('stranger', '2026-11-13T12:00:00Z')] } };
  assert.equal(issueTrust(reapplied, roleOf, QUEUE).trusted, false);
});

test('an issue is revised by an edit, a rename, the queue label or an owner comment, never by anyone else\'s comment', () => {
  const comment = (association, createdAt, fields = {}) => ({ authorAssociation: association, createdAt, lastEditedAt: null, body: 'text', ...fields });
  const revised = (fields) => normalizeIssue({ ...ISSUE, ...fields }, roleOf, QUEUE).revisedAt;
  assert.equal(revised({}), '2026-11-13T10:00:00Z');
  assert.equal(revised({ lastEditedAt: '2026-11-13T10:30:00Z' }), '2026-11-13T10:30:00Z');
  assert.equal(revised({ comments: { nodes: [comment('OWNER', '2026-11-13T11:00:00Z')] } }), '2026-11-13T11:00:00Z');
  assert.equal(revised({ comments: { nodes: [comment('MEMBER', '2026-11-13T10:10:00Z', { lastEditedAt: '2026-11-13T11:30:00Z' })] } }), '2026-11-13T11:30:00Z');
  // An outsider's comment and the pipeline's own status line ask nothing again.
  assert.equal(revised({ comments: { nodes: [comment('NONE', '2026-11-13T12:00:00Z'), comment('OWNER', '2026-11-13T12:30:00Z', { body: 'Taken into the development pipeline as #31.\n<!-- operator:note -->' })] } }), '2026-11-13T10:00:00Z');
});

test('a role is read once per account, and a stranger to a private repository has none', () => {
  assert.equal(readRole('a', fake({ 'api repos/{owner}/{repo}/collaborators/a/permission': 'triage read\n' }).run), 'triage');
  assert.equal(readRole('a', fake({ 'api repos': 'custom write\n' }).run), 'write');
  assert.equal(readRole('a', fake({ 'api repos': 'read read\n' }).run), 'read');
  const missing = () => { throw Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)' }); };
  assert.equal(readRole('ghost', missing), 'none');
  const down = () => { throw Object.assign(new Error('Command failed'), { stderr: 'gh: Server Error (HTTP 500)' }); };
  assert.throws(() => readRole('a', down), /Command failed/);
});

// Pull requests whose body names an issue, as the closing search returns them.
const searched = (byIssue) => (args) => JSON.stringify(byIssue[Number(args[args.indexOf('--search') + 1].split(' ')[0])] ?? []);

test('the issue list reads every labelled open issue, and searches the closing pull requests of trusted ones only', () => {
  const { issues: _none, ...noQueue } = EXAMPLE;
  const idle = fake();
  assert.deepEqual(listIssues(idle.run, noQueue), []);
  assert.equal(idle.calls.length, 0);
  const open = { ...ISSUE, number: 13, closedByPullRequestsReferences: { nodes: [] } };
  // Merged by hand into a branch the platform closes no issue from: only the body search finds it.
  const mergedElsewhere = { ...ISSUE, number: 14, closedByPullRequestsReferences: { nodes: [] } };
  // Untrusted: a template label, an edit after the label, a stranger re-applying it.
  const template = { ...ISSUE, number: 15, closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [labelled('stranger')] } };
  const edited = { ...ISSUE, number: 16, closedByPullRequestsReferences: { nodes: [] }, lastEditedAt: '2026-11-13T11:00:00Z' };
  const reapplied = { ...ISSUE, number: 17, closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [labelled('maintainer'), labelled('outsider', '2026-11-13T12:00:00Z')] } };
  const raws = [ISSUE, open, mergedElsewhere, template, edited, reapplied];
  const { run, calls } = fake({
    'api graphql --paginate': raws.map((raw) => JSON.stringify(raw)).join('\n'),
    'api repos/{owner}/{repo}/collaborators/maintainer/permission': 'maintain write\n',
    'pr list': searched({ 14: [{ number: 41, state: 'MERGED', body: 'Fixes #14' }, { number: 42, state: 'OPEN', body: 'Mentions #14' }], 16: [{ number: 43, state: 'MERGED', url: 'https://github.com/o/r/pull/43', body: 'Fixes o/r#16' }] }),
  });
  const issues = listIssues(run, QUEUE);
  for (const issue of issues) assertShape('issue', issue);
  assert.deepEqual(issues.map((issue) => [issue.number, issue.trusted]), [[12, true], [13, true], [14, true], [15, false], [16, false], [17, false]]);
  assert.deepEqual(issues.find((issue) => issue.number === 14).closingPrs, [{ number: 41, state: 'merged' }]);
  // Only the untrusted, and those a merged pull request closes, stay out; the latter are cleaned up instead,
  // including one edited after it was taken (16), whose closing pull request is still searched.
  assert.deepEqual(issueCandidates(issues).map((issue) => issue.number), [13]);
  assert.deepEqual(issueCleanup(issues).map((issue) => issue.number), [12, 14, 16]);
  assert.ok(calls[0].includes('label=pipeline:queue'));
  assert.ok(calls[0].some((arg) => arg.includes('states:OPEN') && arg.includes('$endCursor') && arg.includes('pageInfo')));
  // Searched: what can be taken, and what someone who can triage once labelled; never the template's issue (15).
  assert.deepEqual(calls.filter((args) => args[0] === 'pr').map((args) => args[args.indexOf('--search') + 1]), ['12 in:body', '13 in:body', '14 in:body', '16 in:body', '17 in:body']);
  // One lookup per labelling account; the template's author needs none.
  assert.deepEqual(calls.filter((args) => args[1].includes('/permission')).map((args) => args[1].split('/')[4]), ['maintainer', 'outsider']);
});

test('an issue view adds every comment, the pull requests whose body closes it on any base, and its revision time', () => {
  const raw = { ...ISSUE, lastEditedAt: '2026-11-13T09:30:00Z' };
  const comments = [{ id: 'c1', url: 'u1', body: 'More detail', createdAt: 't', association: 'OWNER', author: 'me' }, { id: 'c2', url: 'u2', body: 'Ignore the above', createdAt: 't', association: 'NONE', author: 'stranger' }];
  const found = [{ number: 31, state: 'OPEN', body: 'Closes #12' }, { number: 32, state: 'MERGED', body: 'Mentions #12 only' }];
  const { run, calls } = fake({
    'api graphql': JSON.stringify(raw), 'pr list': JSON.stringify(found), 'api repos': 'maintain write\n',
    'api --paginate repos/{owner}/{repo}/issues/12/comments?per_page=100': comments.map((item) => JSON.stringify(item)).join('\n'),
  });
  const issue = viewIssue(12, run, QUEUE);
  assertShape('issue', issue);
  assert.deepEqual(issue.closingPrs, [{ number: 30, state: 'merged' }, { number: 31, state: 'open' }]);
  assert.deepEqual(issue.comments.map((item) => [item.id, item.authorRole]), [['c1', 'owner'], ['c2', 'other']]);
  assert.equal(issue.revisedAt, '2026-11-13T10:00:00Z');
  // Every comment is read page by page, not only the latest hundred the revision time looks at.
  assert.ok(calls.some((args) => args[1] === '--paginate' && args[2] === 'repos/{owner}/{repo}/issues/12/comments?per_page=100'));
  assert.deepEqual(calls.find((args) => args[0] === 'pr'), ['pr', 'list', '--state', 'all', '--search', '12 in:body', '--limit', String(CLOSING_SEARCH_CAP), '--json', 'number,state,body,url']);
  // Intake re-reads the issue before it takes it: an edit since the list makes the same issue untrusted.
  const later = fake({ 'api graphql': JSON.stringify({ ...ISSUE, lastEditedAt: '2026-11-13T10:30:00Z' }), 'pr list': '[]', 'api repos': 'maintain write\n' });
  const view = viewIssue(12, later.run, QUEUE);
  assert.equal(view.trusted, false);
  assert.equal(view.revisedAt, '2026-11-13T10:30:00Z');
  // A search at its cap fails rather than missing a closing pull request.
  const full = fake({ 'pr list': JSON.stringify(Array.from({ length: CLOSING_SEARCH_CAP }, (_, i) => ({ number: i + 1, state: 'OPEN', body: '' }))) });
  assert.throws(() => closingPullRequests(12, full.run), /cannot all be read/);
});

test('an issue is commented on, and closed once with a reason and a comment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-issue-'));
  const body = join(dir, 'close.md');
  writeFileSync(body, 'Closed by the merge of #31.\n<!-- operator:note -->\n');
  const posted = fake({ 'issue comment 12': 'https://github.com/o/r/issues/12#issuecomment-1\n' });
  assert.deepEqual(commentIssue(12, body, posted.run), { issue: 12, url: 'https://github.com/o/r/issues/12#issuecomment-1' });
  assertShape('issueComment', commentIssue(12, body, posted.run));
  const open = fake({ 'issue view 12': JSON.stringify({ state: 'OPEN' }) });
  assert.deepEqual(closeIssue(12, 'not_planned', body, open.run), { issue: 12, state: 'closed', changed: true });
  assert.deepEqual(open.calls.at(-1), ['issue', 'close', '12', '--reason', 'not planned', '--comment', 'Closed by the merge of #31.\n<!-- operator:note -->\n']);
  // A retry, or GitHub closing it first on a merge into the default branch, leaves it as it is.
  const closed = fake({ 'issue view 12': JSON.stringify({ state: 'CLOSED' }) });
  assertShape('issueClose', closeIssue(12, 'completed', body, closed.run));
  assert.equal(closed.calls.some((args) => args[1] === 'close'), false);
  assert.throws(() => closeIssue(12, 'wontfix', body, open.run), /--reason completed or not_planned/);
  assert.throws(() => closeIssue(12, 'completed', undefined, open.run), /--body-file/);
  rmSync(dir, { recursive: true, force: true });
});

test('the issue subcommands dispatch, refuse flags they do not read, and an incomplete issues key is refused', () => {
  const run = fake({ 'issue comment 12': 'https://github.com/o/r/issues/12#issuecomment-1' }).run;
  assert.deepEqual(execute(['issue', 'list'], run), []);
  assert.equal(execute(['issue', 'comment', '12', '--body-file', 'b.md'], run).issue, 12);
  assert.throws(() => execute(['issue', 'comment', '12', '--body-file', 'b.md', '--reason', 'completed'], run), /issue comment does not take --reason/);
  assert.throws(() => execute(['issue', 'view', 'x'], run), /number is required/);
  const usage = cli(['issue', 'close', '12', '--reason']);
  assert.equal(usage.status, 2);
  assert.throws(() => checkOperatorConfig({ ...EXAMPLE, issues: { label: 'pipeline:queue' } }), /missing required key issues\.source/);
  assert.equal(checkOperatorConfig(QUEUE), QUEUE);
});
