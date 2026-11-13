#!/usr/bin/env node
// The forge contract on GitHub: every code-host call the operator layer makes - discovery and the
// operator-* skills - goes through this one script, which the skills reach through profile
// `forge_cli` (references/forge-contract.md). Every answer is JSON.
//
// Contract subcommands, normalized:
//   pr list                       [pr]       open pull requests
//   pr view <n>                   pr
//   pr create --base <b> --head <h> --title <t> --body-file <f> [--draft]   pr
//   pr ready <n>                  pr
//   pr draft <n>                  pr         back to draft: QA capacity goes only to the drafts admission promotes
//   checks <sha>                  { sha, state: none|pending|success|failure, runs: [{ name, state, url }] }
//                                 the deciding workflows only (operator_config ciWorkflows), as discovery judges them
//   threads <n> [--unresolved] [--resolve <id> --body <text>]
//                                 [{ id, resolved, path, line, comments: [{ author, body, createdAt }] }]
//   claim take|release <n> [--takeover]
//                                 { pr, claimed, changed } - or { pr, claimed: false, held: true } with exit 3
//                                 when take finds the processing label (operator_config) already standing;
//                                 --takeover takes a claim the contract lets this run take over, past that check
//   factor set|clear <n> --name <f>   { pr, factor, set }
//   comment <n> --body-file <f>   { pr, url }
//   notes <n>                     [{ id, kind: comment|review, author, authorRole: owner|member|other, state,
//                                    body, inline, createdAt, url }] in time order; an empty commented review
//                                    carries its inline comments' bodies, as discovery reads them
//   merge <n> --method squash|merge|rebase   { pr, state, mergeCommit }
//
//   issue list                    [issue]    open issues carrying the queue label (operator_config `issues`)
//   issue view <n>                issue      with its comments, and every pull request that closes it
//   issue comment <n> --body-file <f>   { issue, url }
//   issue close <n> --reason completed|not_planned --body-file <f>   { issue, state, changed }
//
//   pr = { number, url, title, body, draft, state: open|merged|closed, head: { ref, sha },
//          base: { ref }, mergeable: clean|conflicting|unknown, labels, milestone, createdAt, author,
//          closes: [issue number] }
//   issue = { number, url, title, body, state: open|closed, stateReason, labels, author, authorRole,
//             createdAt, trusted, trust, closingPrs: [{ number, state }], comments? }
//
// Extensions the operator skills and discovery need beyond the core contract, part of it here:
//   pr edit <n> [--claim [--takeover]] [--milestone <title>] [--title <t>] [--body-file <f>]
//               [--add-label <l>]... [--remove-label <l>]...
//                                 pr         a phase hand-off, or a claim with a milestone move, is one edit,
//                                 title and body included; --claim adds the processing label after the check
//                                 `claim take` makes, answering { pr, claimed: false, held: true } (exit 3)
//                                 instead of editing anything
//   A missing or empty option value, one that is itself a flag of this script, or a flag the subcommand
//   does not read is a usage error (exit 2).
//   pr body <n>                   the body as plain text, for a file the review reads
//   pr files <n>                  { pr, files: [path] }   the conflict gate and the merge gates read them
//   events <n>                    [{ id, event: labeled|unlabeled, label, createdAt }]
//
// Configuration: OPERATOR_CONFIG names the operator configuration file (profile `operator_config`);
// it supplies the processing label, the deciding CI workflows (`ciWorkflows`), the author
// associations allowed to speak for the project (`allowedAuthors`) and the issue queue (`issues`); references/operator-config.md
// is its schema, and a file missing a required key is refused (exit 2). A platform's implementation
// is named `forge-<platform>`, so a tool watching for claims can recognize it by name.
//
// Imported as a library, the discovery readers below return GitHub's own shapes for discovery:
// GitHub's own field names (number, isDraft, isCrossRepository, milestone.title, labels[].name, headRefOid, comments,
// reviews, mergeable), workflow runs, label events and an unresolved-thread count.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A command line this script cannot act on: exit 2, nothing done. */
export class UsageError extends Error {}

const configs = new Map();

/**
 * The operator configuration at `path` (default OPERATOR_CONFIG), read once per path. A library
 * caller that already holds its configuration passes it to the functions that take one instead.
 */
export function operatorConfig(path = process.env.OPERATOR_CONFIG) {
  if (!path) throw new UsageError('OPERATOR_CONFIG must name the operator configuration file (profile operator_config)');
  const absolute = resolve(path);
  if (!configs.has(absolute)) configs.set(absolute, checkOperatorConfig(JSON.parse(readFileSync(absolute, 'utf8')), absolute));
  return configs.get(absolute);
}

const REQUIRED_ROLES = {
  milestones: ['queue', 'development', 'codeReview', 'verification', 'humanReview', 'mergeQueue'],
  labels: ['processing', 'accepted', 'onhold', 'revalidate', 'rejected', 'cancelled', 'question'],
};

/** The configuration as given, or a usage error naming the first required key it lacks (references/operator-config.md). */
export function checkOperatorConfig(config, source = 'operator configuration') {
  const missing = (key) => { throw new UsageError(`${source}: missing required key ${key} (references/operator-config.md)`); };
  for (const [group, roles] of Object.entries(REQUIRED_ROLES)) {
    for (const role of roles) if (typeof config?.[group]?.[role] !== 'string' || config[group][role] === '') missing(`${group}.${role}`);
  }
  if ((config.clarifySlots ?? []).length > 0 && !config.milestones.clarification) missing('milestones.clarification');
  for (const key of ['allowedAuthors', 'slots']) if (!Array.isArray(config[key]) || config[key].length === 0) missing(key);
  if (config.issues !== undefined) for (const key of ['label', 'source']) if (typeof config.issues?.[key] !== 'string' || config.issues[key] === '') missing(`issues.${key}`);
  return config;
}

// A network fault between this host and the forge, or a gateway error in front of it.
const TRANSIENT = /connection reset by peer|TLS handshake timeout|i\/o timeout|unexpected EOF|connection refused|no such host|HTTP 50[234]/i;
const READS = new Set(['list', 'view', 'checks', 'diff', 'status']);
const FIELDS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

/** A call that changes nothing on the forge, so asking it again cannot write twice. */
export function isRead(args) {
  if (args[0] !== 'api') return READS.has(args[1]);
  if (args.some((arg) => /^(-X|--method)/.test(arg))) return false;
  if (args[1] === 'graphql') return !args.some((arg) => arg.startsWith('query=') && /\bmutation\b/.test(arg.replace(/#[^\n]*/g, '')));
  return !args.some((arg) => FIELDS.has(arg));
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The one place this layer starts `gh`; every reader and command takes a runner so tests inject one.
 * A read that meets a network fault is asked again, up to three times; a write never is. The pause
 * blocks the process, which suits these short CLI calls and not a long-lived importer.
 */
export function gh(args, { exec = execFileSync, wait = pause, attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return exec('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      if (attempt >= attempts || !isRead(args) || !TRANSIENT.test(String(error.stderr ?? ''))) throw error;
      wait(2000 * attempt);
    }
  }
}

const PR_FIELDS = 'number,url,title,body,isDraft,state,headRefName,headRefOid,baseRefName,mergeable,labels,milestone,createdAt,author';
const MERGEABLE = { MERGEABLE: 'clean', CONFLICTING: 'conflicting' };

// The columns a line is indented by, a tab reaching the next multiple of four.
const indentOf = (line) => {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
};
// A list item: its marker, the spaces after it, which set where the item's content starts, and that content.
const LIST_ITEM = /^[ \t]*([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
// A fence opener; a backtick fence's info string holds no backtick, so `x` on its own line is a code span.
const FENCE = /^(`{3,}(?=[^`]*$)|~{3,})/;

/**
 * A Markdown body without its fenced and indented code, code spans and HTML comments: the platform reads
 * no reference in them. Code inside a list item is indented relative to the item's content, so open list
 * items are kept as a stack of content columns. An approximation of the platform's parser, with no
 * dependency.
 */
function proseOf(body) {
  const prose = [];
  const items = [];
  let fence = null;
  let codeAt = null;
  let afterBlank = true;
  for (const line of String(body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').split('\n')) {
    const blank = line.trim() === '';
    const width = indentOf(line);
    if (fence) {
      const close = /^(`+|~+)[ \t]*$/.exec(line.trimStart())?.[1];
      if (close && width < fence.at + 4 && close[0] === fence.marker[0] && close.length >= fence.marker.length) fence = null;
      continue;
    }
    if (codeAt !== null && (blank || width >= codeAt + 4)) continue;
    codeAt = null;
    const item = width < (items.at(-1) ?? 0) + 4 ? LIST_ITEM.exec(line) : null;
    // A line belongs to the innermost open item whose content it reaches; an item closes the ones it is not inside.
    if (item || (!blank && afterBlank)) while (items.length && width < items.at(-1)) items.pop();
    const base = items.at(-1) ?? 0;
    if (!blank && !item && afterBlank && width >= base + 4) {
      codeAt = base;
      continue;
    }
    afterBlank = blank;
    if (item) {
      // Five or more spaces after the marker are one space and indented code.
      const content = width + item[1].length + (item[2].length >= 1 && item[2].length <= 4 ? item[2].length : 1);
      items.push(content);
      const open = FENCE.exec(item[3])?.[1];
      if (open) fence = { marker: open, at: content };
      else prose.push(item[3]);
      continue;
    }
    const open = width < base + 4 ? FENCE.exec(line.trimStart())?.[1] : null;
    if (open) fence = { marker: open, at: base };
    else prose.push(line);
  }
  // A code span closes on a backtick run of the same length, within its paragraph.
  return prose.join('\n').replace(/(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g, ' ');
}

/** `host/owner/name` of the repository a platform URL points into, or null. */
export function repositoryOf(url) {
  const match = /^https:\/\/([^/]+\/[^/]+\/[^/#?]+)/.exec(String(url ?? ''));
  return match ? match[1] : null;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The issues of this repository a pull request body closes with a closing keyword (`Closes #12`,
 * `fixes: #12`, and with `repository` (`host/owner/name`) given, `owner/name#12` or the issue's URL on
 * that host), outside code. Read from the body itself: the platform links a keyword only when the pull
 * request targets the default branch, and the pipeline needs the link whatever the base. Another
 * repository's issues, on any host, are never named.
 */
export function closesOf(body, repository = null) {
  const [host, ...path] = String(repository ?? '').split('/');
  const name = path.join('/');
  const own = repository ? `|${escape(name)}#|https?://${escape(host)}/${escape(name)}/issues/` : '';
  const pattern = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\\s+(?:#${own})(\\d+)\\b`, 'gi');
  const numbers = new Set();
  for (const match of proseOf(body).matchAll(pattern)) numbers.add(Number(match[1]));
  return [...numbers].sort((a, b) => a - b);
}

/** A pull request in the contract's shape, from `gh pr view/list --json` fields. */
export function normalizePr(raw) {
  return {
    number: raw.number,
    url: raw.url,
    title: raw.title,
    body: raw.body ?? '',
    draft: Boolean(raw.isDraft),
    state: String(raw.state ?? '').toLowerCase(),
    head: { ref: raw.headRefName, sha: raw.headRefOid },
    base: { ref: raw.baseRefName },
    mergeable: MERGEABLE[raw.mergeable] ?? 'unknown',
    labels: (raw.labels ?? []).map((label) => label.name),
    milestone: raw.milestone?.title ?? null,
    createdAt: raw.createdAt,
    author: raw.author?.login ?? null,
    closes: closesOf(raw.body, repositoryOf(raw.url)),
  };
}

export function listPrs(run = gh) {
  return JSON.parse(run(['pr', 'list', '--state', 'open', '--limit', '200', '--json', PR_FIELDS])).map(normalizePr);
}

export function viewPr(number, run = gh) {
  return normalizePr(JSON.parse(run(['pr', 'view', String(number), '--json', PR_FIELDS])));
}

export function createPr({ base, head, title, bodyFile, draft = false }, run = gh) {
  if (!base || !head || !title || !bodyFile) throw new UsageError('pr create needs --base, --head, --title and --body-file');
  const url = run(['pr', 'create', '--base', base, '--head', head, '--title', title, '--body-file', bodyFile, ...(draft ? ['--draft'] : [])]).trim().split('\n').at(-1);
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
  if (!Number.isInteger(number)) throw new Error(`gh pr create printed no pull request URL: ${url}`);
  return viewPr(number, run);
}

export function readyPr(number, run = gh) {
  run(['pr', 'ready', String(number)]);
  return viewPr(number, run);
}

export function draftPr(number, run = gh) {
  run(['pr', 'ready', String(number), '--undo']);
  return viewPr(number, run);
}

/**
 * One edit, so a hand-off moves the milestone, drops the claim and replaces the title or body together
 * or not at all; with --claim, the held check comes first and a held pull request is left untouched.
 */
export function editPr(number, { milestone, title, bodyFile, add = [], remove = [], claim: take = false, takeover = false } = {}, run = gh) {
  const processing = operatorConfig().labels.processing;
  if (add.includes(processing)) throw new UsageError(`${processing} is the claim: use pr edit --claim or claim take`);
  if (takeover && !take) throw new UsageError('--takeover goes with --claim');
  const standing = take && viewPr(number, run).labels.includes(processing);
  // A label already standing is another run's claim unless the contract lets this run take it over.
  if (standing && !takeover) return { pr: number, claimed: false, held: true };
  if (take && !standing) add = [...add, processing];
  const args = ['pr', 'edit', String(number)];
  if (milestone) args.push('--milestone', milestone);
  if (title) args.push('--title', title);
  if (bodyFile) args.push('--body-file', bodyFile);
  for (const label of add) args.push('--add-label', label);
  for (const label of remove) args.push('--remove-label', label);
  if (args.length === 3 && standing) return { pr: number, claimed: true, changed: false, takenOver: true };
  if (args.length === 3) throw new UsageError('pr edit needs --claim, --milestone, --title, --body-file, --add-label or --remove-label');
  run(args);
  return viewPr(number, run);
}

export function prFiles(number, run = gh) {
  return { pr: number, files: (JSON.parse(run(['pr', 'view', String(number), '--json', 'files'])).files ?? []).map((file) => file.path) };
}

export function prBody(number, run = gh) {
  return JSON.parse(run(['pr', 'view', String(number), '--json', 'body'])).body ?? '';
}

const FAILED_RUN = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']);

/** The deciding workflows' latest runs, one per workflow (only `ciWorkflows` when the config names them). */
export function decidingRuns(runs, config) {
  const deciding = config.ciWorkflows ? runs.filter((run) => config.ciWorkflows.includes(run.workflowName)) : runs;
  const latest = new Map();
  for (const run of deciding) {
    const seen = latest.get(run.workflowName);
    if (!seen || Date.parse(run.createdAt) >= Date.parse(seen.createdAt)) latest.set(run.workflowName, run);
  }
  return [...latest.values()];
}

/** Which runs, at which attempt, decide CI now: a re-run changes it while the state may repeat. */
export function ciRunsMark(runs, config = operatorConfig()) {
  const ids = decidingRuns(runs, config).map((run) => `${run.databaseId ?? run.workflowName}.${run.attempt ?? 1}`).sort();
  return ids.length === 0 ? 'none' : createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 8);
}

/**
 * The head's CI state from its workflow runs, the latest attempt of each workflow. The host's token
 * cannot read check runs, but it reads Actions runs, and they cover every workflow, including the
 * required checks.
 */
export function ciFromRuns(runs, config = operatorConfig()) {
  // Only the workflows carrying the required checks decide; a helper workflow a label event cancelled
  // is not a red build.
  const outcomes = decidingRuns(runs, config);
  if (outcomes.length === 0) return 'none';
  // A workflow that already failed decides it: implementation starts on the fix instead of waiting for
  // the slowest suite, whose run for this head the fix's push supersedes anyway.
  if (outcomes.some((run) => run.status === 'completed' && FAILED_RUN.has(run.conclusion))) return 'failure';
  if (outcomes.some((run) => run.status !== 'completed')) return 'pending';
  return 'success';
}

/** One deciding run's state in the contract, by the same conclusion classes `ciFromRuns` uses. */
function runState(run) {
  if (run.status !== 'completed') return 'pending';
  return FAILED_RUN.has(run.conclusion) ? 'failure' : 'success';
}

/**
 * The checks that decide a commit: the deciding workflows (`operator_config` `ciWorkflows`), the latest
 * attempt of each, judged exactly as discovery judges them. `none` while no deciding workflow has run.
 */
export function checks(sha, run = gh, config = operatorConfig()) {
  if (!/^[0-9a-f]{7,40}$/.test(sha ?? '')) throw new UsageError(`checks needs a commit sha (got ${sha})`);
  const runs = JSON.parse(run(['run', 'list', '--commit', sha, '--limit', '100', '--json', 'databaseId,attempt,workflowName,status,conclusion,createdAt,url']));
  return { sha, state: ciFromRuns(runs, config), runs: decidingRuns(runs, config).map((entry) => ({ name: entry.workflowName, state: runState(entry), url: entry.url })) };
}

const THREADS_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved path line comments(first:100){nodes{author{login} body createdAt}}} pageInfo{hasNextPage endCursor}}}}}';

/** Review threads on one PR, every page. */
export function threads(number, { unresolved = false } = {}, run = gh) {
  const output = run(['api', 'graphql', '--paginate', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `number=${number}`, '-f', `query=${THREADS_QUERY}`,
    '--jq', '.data.repository.pullRequest.reviewThreads.nodes[] | @json']);
  return output.split('\n').filter(Boolean).map((line) => JSON.parse(line)).map((node) => ({
    id: node.id,
    resolved: node.isResolved,
    path: node.path,
    line: node.line,
    comments: (node.comments?.nodes ?? []).map((comment) => ({ author: comment.author?.login ?? null, body: comment.body, createdAt: comment.createdAt })),
  })).filter((thread) => !unresolved || !thread.resolved);
}

/** Replies to a review thread and resolves it: a reply without the resolve comes back on the next pass. */
export function resolveThread(id, body, run = gh) {
  if (!id || !body?.trim()) throw new UsageError('--resolve needs a thread id and --body');
  // A retry after the reply landed finds the thread resolved and adds no second reply.
  const resolved = run(['api', 'graphql', '-f', 'query=query($id:ID!){node(id:$id){... on PullRequestReviewThread{isResolved}}}', '-f', `id=${id}`, '--jq', '.data.node.isResolved']).trim();
  if (resolved === 'true') return { id, resolved: true, changed: false };
  run(['api', 'graphql', '-f', 'query=mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}', '-f', `id=${id}`, '-f', `body=${body}`]);
  run(['api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}', '-f', `id=${id}`]);
  return { id, resolved: true, changed: true };
}

/** The processing label is the claim on GitHub; `changed` says whether this call moved it. */
export function claim(action, number, run = gh, { takeover = false } = {}) {
  if (takeover && action !== 'take') throw new UsageError('--takeover goes with claim take');
  const label = operatorConfig().labels.processing;
  const before = viewPr(number, run).labels.includes(label);
  if (action === 'take') {
    // A label already standing is a claim this call did not take: the skill decides whether it may
    // take it over (operator-contract), never this script.
    if (before && takeover) return { pr: number, claimed: true, changed: false, takenOver: true };
    if (before) return { pr: number, claimed: false, held: true };
    run(['pr', 'edit', String(number), '--add-label', label]);
    return { pr: number, claimed: true, changed: true };
  }
  if (action === 'release') {
    if (before) run(['pr', 'edit', String(number), '--remove-label', label]);
    return { pr: number, claimed: false, changed: before };
  }
  throw new UsageError(`claim expects take or release (got ${action})`);
}

export function factor(action, number, name, run = gh) {
  if (!name) throw new UsageError('factor needs --name');
  if (action !== 'set' && action !== 'clear') throw new UsageError(`factor expects set or clear (got ${action})`);
  if (name === operatorConfig().labels.processing) throw new UsageError(`${name} is the claim, not a factor: use claim take|release`);
  run(['pr', 'edit', String(number), action === 'set' ? '--add-label' : '--remove-label', name]);
  return { pr: number, factor: name, set: action === 'set' };
}

export function comment(number, bodyFile, run = gh) {
  if (!bodyFile) throw new UsageError('comment needs --body-file');
  const url = run(['pr', 'comment', String(number), '--body-file', bodyFile]).trim().split('\n').at(-1);
  return { pr: number, url };
}

/** Merges by the named method; never `--admin`, never deletes the branch (the profile keeps remote branches). */
export function merge(number, method, run = gh) {
  if (!['squash', 'merge', 'rebase'].includes(method)) throw new UsageError(`merge expects --method squash, merge or rebase (got ${method})`);
  run(['pr', 'merge', String(number), `--${method}`]);
  const after = JSON.parse(run(['pr', 'view', String(number), '--json', 'state,mergeCommit']));
  return { pr: number, state: String(after.state ?? '').toLowerCase(), mergeCommit: after.mergeCommit?.oid ?? null };
}

/** An issue's label events, read through gh's own jq (no jq binary needed). */
export function readLabelEvents(number, run = gh) {
  return run(['api', '--paginate', `repos/{owner}/{repo}/issues/${number}/events?per_page=100`, '--jq', '.[] | select(.event == "labeled" or .event == "unlabeled") | {id, event, created_at, label: {name: .label.name}} | @json'])
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Label events in the contract's shape. */
export function events(number, run = gh) {
  return readLabelEvents(number, run).map((event) => ({ id: event.id, event: event.event, label: event.label?.name ?? null, createdAt: event.created_at }));
}

// Issues as a queue source (operator_config `issues`). An issue's text is a task an agent carries out
// with the right to push, and anyone may open an issue on a public repository, so the queue label alone
// never makes an issue a task: `trusted` says whether the text comes from someone the project trusts.

const ISSUE_FIELDS = 'number url title body state stateReason createdAt lastEditedAt authorAssociation author{login} labels(first:100){nodes{name}} '
  + 'closedByPullRequestsReferences(first:25,includeClosedPrs:true){nodes{number state mergedAt lastEditedAt}} '
  + 'timelineItems(last:100,itemTypes:[LABELED_EVENT,RENAMED_TITLE_EVENT]){nodes{__typename ... on LabeledEvent{createdAt label{name} actor{login}} ... on RenamedTitleEvent{createdAt}}} '
  + 'comments(last:100){nodes{authorAssociation createdAt lastEditedAt body}}';
const ISSUES_QUERY = `query($owner:String!,$name:String!,$label:String!,$endCursor:String){repository(owner:$owner,name:$name){issues(first:50,after:$endCursor,states:OPEN,labels:[$label],orderBy:{field:CREATED_AT,direction:ASC}){nodes{${ISSUE_FIELDS}} pageInfo{hasNextPage endCursor}}}}`;
const ISSUE_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){${ISSUE_FIELDS}}}}`;

// Roles that can label issues, so a label they apply is theirs and not an issue template's.
const LABELLING_ROLES = new Set(['triage', 'write', 'maintain', 'admin']);
// The only associations an account holding a role in the repository can have.
const ASSOCIATED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** An account's role on this repository (`none` for a stranger to a private one). */
export function readRole(login, run = gh) {
  try {
    const [role, permission] = run(['api', `repos/{owner}/{repo}/collaborators/${login}/permission`, '--jq', '.role_name + " " + .permission']).trim().split(' ');
    return LABELLING_ROLES.has(role) ? role : permission === 'admin' || permission === 'write' ? permission : role || 'none';
  } catch (error) {
    if (/HTTP 404/.test(String(error.stderr ?? error.message))) return 'none';
    throw error;
  }
}

/**
 * Whether an issue's text comes from someone the project trusts: its author speaks for the project
 * (`allowedAuthors`), or someone who can label issues applied the queue label - an issue template can
 * apply a label for its author - and neither the text nor the title changed after they did.
 */
export function issueTrust(raw, roleOf, config = operatorConfig()) {
  const author = raw.author?.login ?? 'an unknown account';
  if (config.allowedAuthors.includes(raw.authorAssociation)) return { trusted: true, trust: `opened by ${author} (${String(raw.authorAssociation).toLowerCase()})` };
  const label = config.issues?.label;
  // The platform lists timeline items oldest first, so the last application in the list is the latest.
  const timeline = raw.timelineItems?.nodes ?? [];
  const index = timeline.findLastIndex((item) => item.__typename === 'LabeledEvent' && label && item.label?.name === label);
  if (index < 0) return { trusted: false, trust: `opened by ${author}, and nobody who can triage applied the queue label` };
  const applied = timeline[index];
  const actor = applied.actor?.login;
  // An author the platform does not associate with the repository holds no role in it: no lookup needed.
  const roleless = actor === raw.author?.login && !ASSOCIATED.has(raw.authorAssociation);
  if (!actor || roleless || !LABELLING_ROLES.has(roleOf(actor))) return { trusted: false, trust: `${label} applied by ${actor ?? 'an unknown account'}, who cannot triage the repository` };
  // An edit in the same second as the label cannot be ordered against it, so it counts as after it; a
  // rename is after it when the timeline lists it later, or at the same second or later.
  const at = Date.parse(applied.createdAt);
  const renamed = timeline.some((item, position) => item.__typename === 'RenamedTitleEvent' && (position > index || Date.parse(item.createdAt) >= at));
  if (Date.parse(raw.lastEditedAt ?? '') >= at || renamed) return { trusted: false, trust: `edited after ${actor} applied ${label}: applying it again trusts the new text` };
  return { trusted: true, trust: `${label} applied by ${actor}` };
}

/**
 * Whether someone who can triage ever applied the queue label, or the author speaks for the project: an
 * issue the pipeline may have taken, so its closing pull requests are searched even once it is untrusted.
 */
function approvedOnce(raw, roleOf, config) {
  if (config.allowedAuthors.includes(raw.authorAssociation)) return true;
  const roleless = (actor) => actor === raw.author?.login && !ASSOCIATED.has(raw.authorAssociation);
  return (raw.timelineItems?.nodes ?? []).some((item) => item.__typename === 'LabeledEvent' && item.label?.name === config.issues?.label
    && item.actor?.login && !roleless(item.actor.login) && LABELLING_ROLES.has(roleOf(item.actor.login)));
}

/**
 * When what intake would take from an issue, or its trust, last changed: its creation, the latest text
 * edit, title rename or queue-label application, and an owner's or member's comment among the latest 100
 * added or edited, the pipeline's own excepted. Nobody else's comment asks discovery again.
 */
function revisedAt(raw, config) {
  const label = config.issues?.label;
  const requirements = (raw.comments?.nodes ?? []).filter((item) => authorRole(item.authorAssociation, config) !== 'other' && !String(item.body ?? '').includes('<!-- operator:'));
  const times = [raw.createdAt, raw.lastEditedAt, ...(raw.timelineItems?.nodes ?? [])
    .filter((item) => item.__typename === 'RenamedTitleEvent' || (item.__typename === 'LabeledEvent' && item.label?.name === label)).map((item) => item.createdAt),
    ...requirements.flatMap((item) => [item.createdAt, item.lastEditedAt])];
  return times.filter(Boolean).reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
}

const STATE_REASONS = { COMPLETED: 'completed', NOT_PLANNED: 'not_planned', REOPENED: 'reopened', DUPLICATE: 'duplicate' };

/**
 * A closing pull request in the contract's shape. Its author may edit the body after the merge, so a
 * merged one whose body changed at or after its merge is no evidence of what the merge closed.
 */
function closingPr(pr) {
  const state = String(pr.state ?? '').toLowerCase();
  const editedAfterMerge = state === 'merged' && pr.lastEditedAt != null && !(Date.parse(pr.lastEditedAt) < Date.parse(pr.mergedAt ?? ''));
  return { number: pr.number, state, editedAfterMerge };
}

/** An issue in the contract's shape; `closing` adds pull requests the platform did not link. */
export function normalizeIssue(raw, roleOf, config = operatorConfig(), closing = []) {
  const prs = new Map();
  for (const pr of [...(raw.closedByPullRequestsReferences?.nodes ?? []), ...closing]) prs.set(pr.number, closingPr(pr));
  return {
    number: raw.number,
    url: raw.url,
    title: raw.title,
    body: raw.body ?? '',
    state: String(raw.state ?? '').toLowerCase(),
    stateReason: STATE_REASONS[raw.stateReason] ?? null,
    labels: (raw.labels?.nodes ?? []).map((label) => label.name),
    author: raw.author?.login ?? null,
    authorRole: authorRole(raw.authorAssociation, config),
    createdAt: raw.createdAt,
    revisedAt: revisedAt(raw, config),
    ...issueTrust(raw, roleOf, config),
    closingPrs: [...prs.values()].sort((a, b) => a.number - b.number),
  };
}

/** One role lookup per account per call. */
function roles(run) {
  const known = new Map();
  return (login) => {
    if (!known.has(login)) known.set(login, readRole(login, run));
    return known.get(login);
  };
}

/** The most pull requests one closing search reads (the platform's search stops there); more fails the read rather than missing one. */
export const CLOSING_SEARCH_CAP = 1000;
const CLOSING_SEARCH = 'query($q:String!,$endCursor:String){search(query:$q,type:ISSUE,first:100,after:$endCursor){nodes{... on PullRequest{number state body url mergedAt lastEditedAt}} pageInfo{hasNextPage endCursor}}}';

/**
 * Every pull request, in any state, whose body closes the issue with a closing keyword. The platform links
 * one only when it targets the default branch, so a pull request merged into another branch is found here.
 */
export function closingPullRequests(number, run = gh) {
  const found = run(['api', 'graphql', '--paginate', '-F', `q=repo:{owner}/{repo} is:pr ${number} in:body`, '-f', `query=${CLOSING_SEARCH}`, '--jq', '.data.search.nodes[] | @json'])
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (found.length >= CLOSING_SEARCH_CAP) throw new Error(`${CLOSING_SEARCH_CAP} or more pull requests mention #${number}: the ones that close it cannot all be read`);
  return found.filter((pr) => closesOf(pr.body, repositoryOf(pr.url)).includes(number));
}

/**
 * Open issues carrying the queue label, oldest first; none when the project has no issue queue. One the
 * pipeline can take or may have taken - trusted now, or labelled by someone who can triage at some point -
 * also has its closing pull requests searched, one search each; an outsider's template label costs none.
 */
export function listIssues(run = gh, config = operatorConfig()) {
  if (!config.issues) return [];
  const output = run(['api', 'graphql', '--paginate', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `label=${config.issues.label}`, '-f', `query=${ISSUES_QUERY}`,
    '--jq', '.data.repository.issues.nodes[] | @json']);
  const roleOf = roles(run);
  return output.split('\n').filter(Boolean).map((line) => {
    const raw = JSON.parse(line);
    const issue = normalizeIssue(raw, roleOf, config);
    return issue.trusted || approvedOnce(raw, roleOf, config) ? normalizeIssue(raw, roleOf, config, closingPullRequests(raw.number, run)) : issue;
  });
}

/** One issue with every comment and every pull request that closes it, on any base. */
export function viewIssue(number, run = gh, config = operatorConfig()) {
  const raw = JSON.parse(run(['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `number=${number}`, '-f', `query=${ISSUE_QUERY}`, '--jq', '.data.repository.issue']));
  const comments = run(['api', '--paginate', `repos/{owner}/{repo}/issues/${number}/comments?per_page=100`,
    '--jq', '.[] | {id: .node_id, url: .html_url, body, createdAt: .created_at, association: .author_association, author: .user.login} | @json'])
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return {
    ...normalizeIssue(raw, roles(run), config, closingPullRequests(number, run)),
    comments: comments.map((item) => ({
      id: item.id, author: item.author ?? null, authorRole: authorRole(item.association, config), body: item.body ?? '', createdAt: item.createdAt, url: item.url ?? null,
    })),
  };
}

export function commentIssue(number, bodyFile, run = gh) {
  if (!bodyFile) throw new UsageError('issue comment needs --body-file');
  const url = run(['issue', 'comment', String(number), '--body-file', bodyFile]).trim().split('\n').at(-1);
  return { issue: number, url };
}

const CLOSE_REASONS = { completed: 'completed', not_planned: 'not planned' };

/** Closes an open issue with one comment saying why; an issue already closed is left as it is. */
export function closeIssue(number, reason, bodyFile, run = gh) {
  if (!CLOSE_REASONS[reason]) throw new UsageError(`issue close expects --reason completed or not_planned (got ${reason})`);
  if (!bodyFile) throw new UsageError('issue close needs --body-file');
  const state = JSON.parse(run(['issue', 'view', String(number), '--json', 'state'])).state;
  if (String(state).toUpperCase() === 'CLOSED') return { issue: number, state: 'closed', changed: false };
  run(['issue', 'close', String(number), '--reason', CLOSE_REASONS[reason], '--comment', readFileSync(bodyFile, 'utf8')]);
  return { issue: number, state: 'closed', changed: true };
}

// Discovery readers: GitHub's own shapes, for a discovery implementation.

/**
 * The list returns at most the first 100 comments and reviews of each pull request, so a long PR would
 * read as if its newest reports never happened; a PR at that cap has its whole conversation read again.
 */
export const LIST_CONVERSATION_CAP = 100;

export function readPullRequests(run = gh) {
  const prs = JSON.parse(run(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,url,isDraft,isCrossRepository,milestone,labels,headRefOid,headRefName,createdAt,body,comments,reviews,mergeable']));
  for (const pr of prs) {
    if ((pr.comments ?? []).length < LIST_CONVERSATION_CAP && (pr.reviews ?? []).length < LIST_CONVERSATION_CAP) continue;
    const full = JSON.parse(run(['pr', 'view', String(pr.number), '--json', 'comments,reviews']));
    pr.comments = full.comments ?? [];
    pr.reviews = full.reviews ?? [];
  }
  return prs;
}

/** Workflow runs on one commit; Actions keeps every attempt, discovery's `ciFromRuns` takes the latest. */
export function readRuns(head, run = gh) {
  return JSON.parse(run(['run', 'list', '--commit', head, '--limit', '100', '--json', 'databaseId,attempt,workflowName,status,conclusion,createdAt']));
}

/** Unresolved review threads on one PR, every page: a merge refuses while any stands, so resolving one asks again. */
export function readUnresolvedThreads(number, run = gh) {
  const query = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}';
  const output = run(['api', 'graphql', '--paginate', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `number=${number}`, '-f', `query=${query}`,
    '--jq', '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | 1']);
  return output.split('\n').filter(Boolean).length;
}

/**
 * An inline review keeps its text on its comments, so its own body is empty whoever wrote it - a
 * pipeline reply in a review thread arrives as one. Each empty commented review gets its comments'
 * bodies as `inline`, one query per PR that has any, for discovery's owner-input filter to judge like
 * other text.
 */
export function readInlineReviews(prs, run = gh) {
  const query = 'query($ids:[ID!]!){nodes(ids:$ids){... on PullRequestReview{id comments(first:100){nodes{body}}}}}';
  for (const pr of prs) {
    const empty = (pr.reviews ?? []).filter((review) => review.state === 'COMMENTED' && (review.body ?? '').trim() === '');
    for (let start = 0; start < empty.length; start += 100) {
      const chunk = empty.slice(start, start + 100);
      const output = run(['api', 'graphql', '-f', `query=${query}`, ...chunk.flatMap((review) => ['-f', `ids[]=${review.id}`]),
        '--jq', '.data.nodes[] | {id, bodies: [.comments.nodes[].body]}']);
      const bodies = new Map(output.split('\n').filter(Boolean).map((line) => JSON.parse(line)).map((node) => [node.id, node.bodies]));
      for (const review of chunk) review.inline = bodies.get(review.id) ?? [];
    }
  }
  return prs;
}

/** One PR's conversation in the shape discovery reads: comments, and reviews with their inline bodies. */
export function readConversation(number, run = gh) {
  const pr = JSON.parse(run(['pr', 'view', String(number), '--json', 'number,comments,reviews']));
  return readInlineReviews([pr], run)[0];
}

/** The owner, then the other accounts operator_config allows to speak for the project, then everyone else. */
export function authorRole(association, config = operatorConfig()) {
  if (!config.allowedAuthors.includes(association)) return 'other';
  return association === 'OWNER' ? 'owner' : 'member';
}

/** The conversation in the contract's shape, oldest first. */
export function notes(number, run = gh, config = operatorConfig()) {
  const pr = readConversation(number, run);
  const items = [
    ...(pr.comments ?? []).map((item) => ({ ...item, kind: 'comment', time: item.createdAt })),
    ...(pr.reviews ?? []).map((item) => ({ ...item, kind: 'review', time: item.submittedAt ?? item.createdAt })),
  ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    author: item.author?.login ?? null,
    authorRole: authorRole(item.authorAssociation, config),
    ...(item.kind === 'review' ? { state: String(item.state ?? '').toLowerCase() } : {}),
    body: item.body ?? '',
    ...(item.inline ? { inline: item.inline } : {}),
    createdAt: item.time,
    url: item.url ?? null,
  }));
}

/** The options that take a value; every other flag is a switch. */
const VALUE_FLAGS = new Set(['--milestone', '--add-label', '--remove-label', '--base', '--head', '--title', '--body-file', '--resolve', '--body', '--name', '--method', '--to', '--reason']);

/** The flags each subcommand reads; any other flag is a usage error, never silently ignored. */
export const SUBCOMMAND_FLAGS = {
  'pr create': ['--base', '--head', '--title', '--body-file', '--draft'],
  'pr edit': ['--claim', '--takeover', '--milestone', '--title', '--body-file', '--add-label', '--remove-label'],
  threads: ['--unresolved', '--resolve', '--body'],
  claim: ['--takeover'],
  factor: ['--name'],
  comment: ['--body-file'],
  merge: ['--method'],
  'issue comment': ['--body-file'],
  'issue close': ['--reason', '--body-file'],
};

/** Every flag of this script: a missing value is never taken for another option. */
export const FLAGS = new Set(Object.values(SUBCOMMAND_FLAGS).flat());

/** Refuses a flag `subcommand` does not read; the value after an option is skipped, whatever it looks like. */
function onlyFlags(args, subcommand) {
  const allowed = SUBCOMMAND_FLAGS[subcommand] ?? [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) continue;
    if (!allowed.includes(arg)) throw new UsageError(`${subcommand} does not take ${arg}`);
    if (VALUE_FLAGS.has(arg)) index += 1;
  }
}

/** The value after `name`; an option given without a real value is a usage error, never a silent default. */
function valueAt(args, index, name) {
  const value = args[index + 1];
  // A body like `-- done` is a value; only another of this script's flags means the value is missing.
  if (value === undefined || value.trim() === '' || FLAGS.has(value)) throw new UsageError(`${name} needs a value`);
  return value;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? valueAt(args, index, name) : undefined;
}

function options(args, name) {
  return args.flatMap((arg, index) => (arg === name ? [valueAt(args, index, name)] : []));
}

function number(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`a pull request or issue number is required (got ${value})`);
  return parsed;
}

const SUBCOMMANDS = new Set(['pr list', 'pr view', 'pr create', 'pr ready', 'pr draft', 'pr edit', 'pr body', 'pr files', 'checks', 'threads', 'claim', 'factor', 'comment', 'notes', 'merge', 'events', 'issue list', 'issue view', 'issue comment', 'issue close']);

const USAGE = 'usage: forge-github.mjs pr list|view <n>|create ...|ready <n>|draft <n>|edit <n> [--claim] [--milestone <m>] [--title <t>] [--body-file <f>] ...|body <n>|files <n> | checks <sha> | threads <n> [--unresolved] [--resolve <id> --body <text>] | claim take|release <n> | factor set|clear <n> --name <f> | comment <n> --body-file <f> | notes <n> | merge <n> --method <m> | events <n> | issue list|view <n>|comment <n> --body-file <f>|close <n> --reason completed|not_planned --body-file <f>';

/** Runs one subcommand and returns what it prints: JSON, or plain text for `pr body`. */
export function execute(args, run = gh) {
  const [command, action, target] = args;
  const subcommand = command === 'pr' || command === 'issue' ? `${command} ${action}` : command;
  if (SUBCOMMANDS.has(subcommand)) onlyFlags(args, subcommand);
  if (command === 'pr') {
    if (action === 'list') return listPrs(run);
    if (action === 'view') return viewPr(number(target), run);
    if (action === 'create') return createPr({ base: option(args, '--base'), head: option(args, '--head'), title: option(args, '--title'), bodyFile: option(args, '--body-file'), draft: args.includes('--draft') }, run);
    if (action === 'ready') return readyPr(number(target), run);
    if (action === 'draft') return draftPr(number(target), run);
    if (action === 'edit') return editPr(number(target), { milestone: option(args, '--milestone'), title: option(args, '--title'), bodyFile: option(args, '--body-file'), add: options(args, '--add-label'), remove: options(args, '--remove-label'), claim: args.includes('--claim'), takeover: args.includes('--takeover') }, run);
    if (action === 'body') return { text: prBody(number(target), run) };
    if (action === 'files') return prFiles(number(target), run);
  }
  if (command === 'checks') return checks(action, run);
  if (command === 'threads') {
    if (args.includes('--resolve')) return resolveThread(option(args, '--resolve'), option(args, '--body'), run);
    return threads(number(action), { unresolved: args.includes('--unresolved') }, run);
  }
  if (command === 'claim') return claim(action, number(target), run, { takeover: args.includes('--takeover') });
  if (command === 'factor') return factor(action, number(target), option(args, '--name'), run);
  if (command === 'comment') return comment(number(action), option(args, '--body-file'), run);
  if (command === 'merge') return merge(number(action), option(args, '--method'), run);
  if (command === 'events') return events(number(action), run);
  if (command === 'notes') return notes(number(action), run);
  if (command === 'issue') {
    if (action === 'list') return listIssues(run);
    if (action === 'view') return viewIssue(number(target), run);
    if (action === 'comment') return commentIssue(number(target), option(args, '--body-file'), run);
    if (action === 'close') return closeIssue(number(target), option(args, '--reason'), option(args, '--body-file'), run);
  }
  throw new UsageError(USAGE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = execute(process.argv.slice(2));
    process.stdout.write(result && typeof result.text === 'string' && process.argv[2] === 'pr' && process.argv[3] === 'body' ? result.text : `${JSON.stringify(result, null, 2)}\n`);
    if (result?.held) process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`forge-github: ${String(error.stderr || error.message).trim()}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
