import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.log('Git secret-scanning hooks enabled for this checkout.');
} catch {
  // npm can run prepare outside a Git checkout (for example, from a source archive).
}
