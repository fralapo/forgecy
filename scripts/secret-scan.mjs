#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mode = process.argv[2];
const placeholder = /^(?:your[_ -]|change[_ -]?me|example|placeholder|test[_ -]?key|dummy|\*+|x{3,}|<|\$\{|process\.env\b)/i;
const rules = [
  ['OpenRouter token', /\bsk-or-v1-[A-Za-z0-9]{20,}\b/],
  ['OpenAI token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['Anthropic token', /\bsk-ant-api\d+-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe secret key', /\bsk_(?:live|test)_[0-9A-Za-z]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential assignment', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret[_-]?key)\b\s*[:=]\s*["']([^"']{12,})["']/i],
];

if (process.argv[2] === '--self-test') {
  const samples = [
    { line: `OPENROUTER_API_KEY=${'sk-or-v1-' + 'A'.repeat(24)}`, shouldBlock: true },
    { line: 'OPENAI_API_KEY="your_key_goes_here"', shouldBlock: false },
  ];
  const passed = samples.every(({ line, shouldBlock }) => {
    const found = rules.some(([name, pattern]) => {
      const match = line.match(pattern);
      if (!match) return false;
      const value = name === 'credential assignment' ? match[1] : match[0];
      return !placeholder.test(value);
    });
    return found === shouldBlock;
  });
  console.log(passed ? 'Secret scanner self-test passed.' : 'Secret scanner self-test failed.');
  process.exit(passed ? 0 : 1);
}

function git(args, input) {
  return execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });
}

function changedLines(diff) {
  const results = [];
  let file = '(unknown file)';
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    if (line.startsWith('+') && !line.startsWith('+++')) results.push({ file, line: line.slice(1) });
  }
  return results;
}

let lines;
try {
  if (mode === '--staged') {
    lines = changedLines(git(['diff', '--cached', '--no-ext-diff', '--unified=0', '--no-color']));
  } else if (mode === '--range' && process.argv[3] && process.argv[4]) {
    lines = changedLines(git(['diff', `${process.argv[3]}..${process.argv[4]}`, '--no-ext-diff', '--unified=0', '--no-color']));
  } else if (mode === '--outgoing' && process.argv[3]) {
    const commits = git(['rev-list', process.argv[3], '--not', '--remotes']).trim().split(/\r?\n/).filter(Boolean);
    lines = commits.flatMap((commit) => changedLines(git(['show', '--format=', '--no-ext-diff', '--unified=0', '--no-color', commit])));
  } else if (mode === '--tracked') {
    const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
    lines = files.flatMap((file) => {
      return readFileSync(file, 'utf8').split(/\r?\n/).map((line) => ({ file, line }));
    });
  } else {
    console.error('Usage: secret-scan.mjs --staged | --tracked | --range <base> <head> | --outgoing <head> | --self-test');
    process.exit(2);
  }
} catch (error) {
  if (mode === '--tracked' && error.status === 1) lines = [];
  else {
    console.error('Secret scan could not complete; refusing to continue.');
    process.exit(2);
  }
}

const findings = [];
for (const { file, line } of lines) {
  for (const [name, pattern] of rules) {
    const match = line.match(pattern);
    if (!match) continue;
    const value = name === 'credential assignment' ? match[1] : match[0];
    if (placeholder.test(value)) continue;
    findings.push({ file, name });
    break;
  }
}

if (findings.length) {
  console.error(`Secret scan blocked ${findings.length} possible credential(s):`);
  for (const finding of findings) console.error(`  ${finding.file}: ${finding.name} (value redacted)`);
  console.error('Move credentials to local environment variables or a secret manager, then retry.');
  process.exit(1);
}
console.log('Secret scan passed.');
