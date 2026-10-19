import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, generate, installGuide, preset } from '../src/generator.js';

const build = changes => generate({ ...defaults(), ...changes });
const invalid = (changes, field) => {
  const result = build(changes);
  assert.equal(result.unit, '');
  assert.equal(result.filename, '');
  assert.ok(result.errors.some(error => error.field === field), JSON.stringify(result.errors));
};

test('default user unit has exact shape and one final LF', () => {
  assert.deepEqual(build(), {
    errors: [], filename: 'my-app.service',
    unit: '[Unit]\nDescription=My application service\nStartLimitIntervalSec=60s\nStartLimitBurst=5\n\n[Service]\nType=exec\nExecStart=:"/usr/local/bin/my-app"\nRestart=on-failure\nRestartSec=5s\nTimeoutStartSec=90s\nTimeoutStopSec=90s\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=default.target\n',
  });
});

test('literal arguments preserve quotes, backslashes, spaces, shell syntax, dollars, specifiers and empty values', () => {
  const { unit, errors } = build({ args: ['', 'two words', ' "quoted" ', "it's fine", 'C:\\bin\\', '$HOME ${USER} $$', '%n %%', ';', '|', '>', '\\n'] });
  assert.deepEqual(errors, []);
  assert.ok(unit.includes('ExecStart=:"/usr/local/bin/my-app" "" "two words" " \\"quoted\\" " "it\'s fine" "C:\\\\bin\\\\" "$HOME ${USER} $$" "%%n %%%%" ";" "|" ">" "\\\\n"\n'));
});

test('environment has its own serialization; $ is not expanded', () => {
  const { unit, errors } = build({
    environment: [{ key: 'APP_VALUE', value: 'a="b"\\c %n $HOME' }, { key: 'EMPTY', value: '' }],
    environmentFile: '/etc/my app/env %n',
    workingDirectory: '/opt/my app',
    description: 'App "quoted" 100% $HOME',
  });
  assert.deepEqual(errors, []);
  assert.ok(unit.includes('Description=App "quoted" 100%% $HOME\n'));
  assert.ok(unit.includes('WorkingDirectory=/opt/my app\n'));
  assert.ok(unit.includes('Environment="APP_VALUE=a=\\"b\\"\\\\c %%n $HOME"\nEnvironment="EMPTY="\n'));
  assert.ok(unit.includes('EnvironmentFile=/etc/my app/env %%n\n'));
});

test('system units require an existing-account selection and root confirmation', () => {
  invalid({ mode: 'system' }, 'user');
  for (const user of ['root', '0']) {
    invalid({ mode: 'system', user }, 'allowRoot');
    assert.deepEqual(build({ mode: 'system', user, allowRoot: true }).errors, []);
  }
  for (const user of ['00', '4294967295', 'user\nGroup=root', 'User Name', ' appuser']) invalid({ mode: 'system', user }, 'user');
  invalid({ mode: 'system', user: 'appuser', group: 'not a group' }, 'group');
  const { unit } = build({ mode: 'system', user: 'appuser', group: 'appgroup', noNewPrivileges: true, privateTmp: true, protectHome: true, protectSystem: true });
  for (const line of ['User=appuser', 'Group=appgroup', 'NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=full', 'ProtectHome=read-only', 'WantedBy=multi-user.target']) assert.ok(unit.includes(`${line}\n`));
});

test('user units never include privileged directives, even with stale system settings', () => {
  const { unit } = build({ user: 'root', group: 'root', allowRoot: true, noNewPrivileges: true, privateTmp: true, protectSystem: true, protectHome: true });
  assert.doesNotMatch(unit, /^(User|Group|NoNewPrivileges|PrivateTmp|ProtectSystem|ProtectHome)=/m);
  assert.match(unit, /WantedBy=default.target/);
});

test('supported types, restart policies and oneshot combinations', () => {
  for (const type of ['exec', 'simple', 'oneshot']) {
    for (const restart of ['no', 'on-failure', 'on-abnormal', 'always']) {
      if (type === 'oneshot' && restart === 'always') invalid({ type, restart }, 'restart');
      else assert.deepEqual(build({ type, restart }).errors, []);
    }
  }
  invalid({ type: 'notify' }, 'type');
  invalid({ type: 'forking' }, 'type');
  invalid({ restart: 'on-success' }, 'restart');
  invalid({ remainAfterExit: true }, 'remainAfterExit');
  assert.match(build({ type: 'oneshot', restart: 'no', remainAfterExit: true }).unit, /RemainAfterExit=yes/);
});

test('dependency ordering and activation stay distinct', () => {
  const { unit } = build({ mode: 'system', user: 'appuser', after: 'network-online.target other@instance.service', wants: 'network-online.target', requires: 'other@instance.service' });
  assert.ok(unit.includes('After=network-online.target other@instance.service\nWants=network-online.target\nRequires=other@instance.service\n'));
  assert.doesNotMatch(build({ wants: 'other.service' }).unit, /^After=/m);
  for (const after of ['network-online.target', 'multi-user.target', 'my-app.service', 'x@.service', 'x@@instance.service', 'a.service\nUser=root', 'a%nb.service', '*.service', 'a', '/a.service']) invalid({ after }, 'after');
  invalid({ after: 'default.target' }, 'after');
  invalid({ mode: 'system', user: 'appuser', after: 'multi-user.target' }, 'after');
});

test('rejects invalid names, control characters, raw directive injection and malformed paths', () => {
  for (const name of ['', '../a', 'a.service', 'a b', 'a@b', 'a\nUser=root', 'x'.repeat(65)]) invalid({ name }, 'name');
  for (const description of ['', 'x\n[Service]', 'x\rUser=root', 'x\\', ' x', 'x ', '\u0000', '\ud800', 'x'.repeat(201)]) invalid({ description }, 'description');
  for (const field of ['executable', 'workingDirectory', 'environmentFile']) {
    for (const path of ['relative', '~/app', '/app\nUser=root', '/app\\', '/path/*', '/path/[a]', '/x/../app', '/x//app', '/x/./app', '/app ', '/"app"']) invalid({ [field]: path }, field);
  }
  invalid({ executable: '/' }, 'executable');
  for (const control of ['\n', '\r', '\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029', '\ud800']) {
    invalid({ args: [`x${control}User=root`] }, 'arguments');
    invalid({ environment: [{ key: 'GOOD', value: `x${control}` }] }, 'environment');
  }
});

test('numeric limits are validated, not coerced, and include boundaries', () => {
  for (const field of ['restartSec', 'startLimitInterval', 'startLimitBurst', 'timeoutStart', 'timeoutStop']) {
    for (const value of ['', '-1', '1.5', '1e2', 'Infinity', ' 1', '01', '99999999999999', '1\nUser=root']) invalid({ [field]: value }, field);
  }
  invalid({ startLimitInterval: '0' }, 'startLimitInterval');
  invalid({ startLimitBurst: '1001' }, 'startLimitBurst');
  assert.deepEqual(build({ restartSec: '0', startLimitInterval: '86400', startLimitBurst: '1000', timeoutStart: '1' }).errors, []);
});

test('environment and argument limits, duplicate names and invalid structures', () => {
  for (const key of ['', '1KEY', 'A-B', 'A=B', 'A\nB']) invalid({ environment: [{ key, value: 'x' }] }, 'environment');
  invalid({ environment: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] }, 'environment');
  invalid({ environment: [null] }, 'environment');
  invalid({ environment: null }, 'environment');
  invalid({ args: null }, 'arguments');
  invalid({ args: Array(65).fill('x') }, 'arguments');
  invalid({ args: ['x'.repeat(4097)] }, 'arguments');
  const maximum = build({ args: Array(64).fill('\\'.repeat(4096)) });
  assert.equal(maximum.errors.length, 0);
  assert.ok(maximum.unit.split('\n').every(line => Buffer.byteLength(line) < 1024 * 1024));
});

test('recipes are valid, distinct and return independent mutable lists', () => {
  for (const name of ['native', 'python', 'oneshot']) assert.deepEqual(generate(preset(name)).errors, []);
  assert.deepEqual(preset('python').args, ['-u', '/opt/my-app/main.py']);
  assert.equal(preset('oneshot').restart, 'no');
  const config = defaults();
  config.args.push('changed');
  assert.deepEqual(defaults().args, []);
});

test('guide switches manager, target, journal and safe destination without auto-enabling linger', () => {
  const user = JSON.stringify(installGuide(defaults()));
  const system = JSON.stringify(installGuide({ ...defaults(), mode: 'system', user: 'appuser' }));
  assert.match(user, /systemctl --user/);
  assert.match(user, /journalctl --user/);
  assert.match(user, /\.config\/systemd\/user/);
  assert.doesNotMatch(user, /sudo systemctl/);
  assert.match(system, /sudo systemctl/);
  assert.match(system, /\/etc\/systemd\/system/);
  for (const guide of [user, system]) {
    assert.match(guide, /set -C/);
    assert.match(guide, /FragmentPath/);
    assert.match(guide, /enable --now/);
    assert.match(guide, /does not run the service/);
    assert.doesNotMatch(guide, /loginctl enable-linger/);
  }
  const leadingDash = JSON.stringify(installGuide({ ...defaults(), name: '-app' }));
  assert.match(leadingDash, /start -- -app\.service/);
  assert.match(leadingDash, /cat -- -app\.service/);
});
