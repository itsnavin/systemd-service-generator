import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { defaults, generate, preset } from '../src/generator.js';

assert.equal(process.platform, 'linux', 'Run this syntax-only check on Ubuntu Linux.');
const version = spawnSync('systemd-analyze', ['--version'], { encoding: 'utf8' });
assert.equal(version.status, 0, version.stderr);
console.log(version.stdout.split('\n')[0]);
assert.ok(Number(version.stdout.match(/systemd (\d+)/)?.[1]) >= 249, 'systemd 249+ required');
const directory = mkdtempSync(join(tmpdir(), 'unitcraft-'));
const fixtureUser = userInfo().username;
try {
  const working = join(directory, 'working space %n');
  const envFile = join(directory, 'environment space %n');
  const executable = join(directory, 'executable space %n $HOME');
  mkdirSync(working);
  mkdirSync(join(directory, 'runtime'), { mode: 0o700 });
  writeFileSync(envFile, 'FROM_FILE=literal\n');
  copyFileSync('/usr/bin/true', executable);
  chmodSync(executable, 0o755);
  const cases = [
    { ...defaults(), mode: 'system', user: fixtureUser, allowRoot: true, group: String(process.getgid()), executable: '/usr/bin/true' },
    { ...defaults(), mode: 'system', user: fixtureUser, allowRoot: true, executable, args: ['', 'two words', ';', '$HOME', '${USER}', '%n', '%%', '"quote"', '\\path\\', '|', '>'], workingDirectory: working, environmentFile: envFile, environment: [{ key: 'VALUE', value: '"quoted" \\ $HOME %n' }], noNewPrivileges: true, privateTmp: true, protectSystem: true, protectHome: true },
    { ...defaults(), type: 'simple', mode: 'system', user: '0', allowRoot: true, executable: '/usr/bin/true', restart: 'always', after: 'network-online.target', wants: 'network-online.target' },
    { ...preset('oneshot'), mode: 'system', user: fixtureUser, allowRoot: true, executable: '/usr/bin/true', remainAfterExit: true },
    { ...preset('oneshot'), mode: 'system', user: fixtureUser, allowRoot: true, executable: '/usr/bin/true', restart: 'on-failure' },
    { ...preset('python'), mode: 'system', user: fixtureUser, allowRoot: true, args: ['-V'] },
    { ...defaults(), executable: '/usr/bin/true', after: 'default.target' },
    { ...preset('oneshot'), executable: '/usr/bin/true', remainAfterExit: true },
  ];
  for (const [index, config] of cases.entries()) {
    config.name = `fixture-${index}`;
    const result = generate(config);
    assert.deepEqual(result.errors, []);
    const path = join(directory, result.filename);
    writeFileSync(path, result.unit);
    const user = config.mode === 'user';
    const checked = spawnSync('systemd-analyze', [...(user ? ['--user'] : []), '--man=no', 'verify', path], {
      encoding: 'utf8',
      env: { ...process.env, XDG_RUNTIME_DIR: join(directory, 'runtime'), SYSTEMD_LOG_LEVEL: 'warning', SYSTEMD_UNIT_PATH: `${directory}:${user ? '/etc/systemd/user:/usr/lib/systemd/user' : '/etc/systemd/system:/usr/lib/systemd/system'}` },
    });
    assert.equal(checked.status, 0, `${result.filename}: ${checked.stderr || checked.error}`);
    assert.equal(checked.stderr.trim(), '', `${result.filename} emitted warnings: ${checked.stderr}`);
    console.log(`Verified ${result.filename} (${config.mode}, ${config.type})`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('Syntax checks only. No jobs registered, installed, enabled or started.');
