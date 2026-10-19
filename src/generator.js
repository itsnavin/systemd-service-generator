const clean = value => typeof value === 'string' && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(value);
const literal = value => value.replace(/%/g, '%%');
const quote = value => `"${literal(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
// These raw-path directives do not unquote/C-unescape like ExecStart does.
const pathValid = value => clean(value) && value.startsWith('/') && value.length <= 4096 &&
  value === value.trim() && !/[\\"'*?[\]{}]/u.test(value) &&
  !value.includes('//') && !value.split('/').some(part => part === '.' || part === '..');
const unitName = /^[A-Za-z0-9_:.-]+(?:@[A-Za-z0-9_:.-]+)?\.(service|target|socket|mount|automount|path|timer|slice|scope)$/;
const account = /^(?:[a-z_][a-z0-9_-]{0,30}|0|[1-9][0-9]{0,9})$/;
const systemTargets = new Set(['multi-user.target', 'graphical.target', 'network.target', 'network-online.target', 'sysinit.target', 'basic.target', 'local-fs.target', 'remote-fs.target', 'shutdown.target']);

export function defaults() {
  return {
    mode: 'user', name: 'my-app', description: 'My application service',
    type: 'exec', executable: '/usr/local/bin/my-app', args: [],
    user: '', group: '', allowRoot: false, workingDirectory: '',
    environment: [], environmentFile: '', restart: 'on-failure', restartSec: '5',
    startLimitInterval: '60', startLimitBurst: '5', timeoutStart: '90', timeoutStop: '90',
    after: '', wants: '', requires: '', remainAfterExit: false,
    noNewPrivileges: false, privateTmp: false, protectSystem: false, protectHome: false,
  };
}

export function preset(name) {
  const config = defaults();
  if (name === 'python') return { ...config, description: 'My Python application', executable: '/usr/bin/python3', args: ['-u', '/opt/my-app/main.py'] };
  if (name === 'oneshot') return { ...config, description: 'My one-time task', executable: '/usr/local/bin/my-task', type: 'oneshot', restart: 'no' };
  return config;
}

export function generate(config) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  if (!['user', 'system'].includes(config.mode)) fail('mode', 'Choose a system or user service.');
  if (!clean(config.name) || !/^[A-Za-z0-9_-]{1,64}$/.test(config.name)) fail('name', 'Use 1-64 letters, numbers, dashes or underscores, without .service.');
  if (!clean(config.description) || !config.description.trim() || config.description.length > 200 ||
      config.description !== config.description.trim() || config.description.includes('\\')) fail('description', 'Enter 1-200 characters without control characters, backslashes or outer whitespace.');
  if (!['simple', 'exec', 'oneshot'].includes(config.type)) fail('type', 'Choose simple, exec or oneshot.');
  for (const field of ['executable', 'workingDirectory', 'environmentFile']) {
    if ((field === 'executable' || config[field] !== '') && !pathValid(config[field])) fail(field, `${field}: use an absolute, normalized Linux path (up to 4096 characters). No controls, quotes, backslashes, glob characters or outer whitespace.`);
  }
  if (pathValid(config.executable) && config.executable.endsWith('/')) fail('executable', 'Executable must name a file, not a directory.');
  if (!Array.isArray(config.args) || config.args.length > 64 || config.args.some(arg => !clean(arg) || arg.length > 4096)) fail('arguments', 'Use at most 64 literal arguments, each up to 4096 characters without control characters.');
  if (config.mode === 'system') {
    if (!clean(config.user) || !account.test(config.user) || Number(config.user) > 4294967294) fail('user', 'Enter an existing lowercase Linux username or numeric UID (0-4294967294, no leading zeroes).');
    if (config.group !== '' && (!clean(config.group) || !account.test(config.group) || Number(config.group) > 4294967294)) fail('group', 'Enter an existing lowercase group name or numeric GID (0-4294967294, no leading zeroes).');
    if ((config.user === 'root' || config.user === '0') && config.allowRoot !== true) fail('allowRoot', 'Explicitly confirm root privileges or choose an unprivileged account.');
  }
  if (!['no', 'on-failure', 'always', 'on-abnormal'].includes(config.restart)) fail('restart', 'Choose a supported restart policy.');
  if (config.type === 'oneshot' && config.restart === 'always') fail('restart', 'Type=oneshot cannot use Restart=always.');
  if (config.type !== 'oneshot' && config.remainAfterExit) fail('remainAfterExit', 'RemainAfterExit is only offered for oneshot tasks.');
  for (const [field, label, min, max] of [
    ['restartSec', 'Restart delay', 0, 86400], ['startLimitInterval', 'Start-limit window', 1, 86400],
    ['startLimitBurst', 'Maximum starts', 1, 1000], ['timeoutStart', 'Start timeout', 1, 86400], ['timeoutStop', 'Stop timeout', 1, 86400],
  ]) {
    if (typeof config[field] !== 'string' || !/^(0|[1-9]\d*)$/.test(config[field]) || Number(config[field]) < min || Number(config[field]) > max) fail(field, `${label} must be a whole number from ${min} to ${max} (no leading zeroes).`);
  }
  const dependencies = {};
  for (const field of ['after', 'wants', 'requires']) {
    if (!clean(config[field]) || config[field].length > 2048) {
      fail(field, `${field}: use space-separated unit names, without controls (up to 2048 characters).`);
      continue;
    }
    dependencies[field] = config[field].split(' ').filter(Boolean);
    for (const unit of dependencies[field]) {
      if (!unitName.test(unit) || unit.length > 255 || unit.includes('..') || unit.startsWith('.')) fail(field, `${field}: "${unit}" is not a supported literal unit name.`);
      if (unit === `${config.name}.service`) fail(field, `${field}: a service cannot depend on itself.`);
      if (config.mode === 'user' && systemTargets.has(unit)) fail(field, `${unit} belongs to the system manager; do not reference it from a user service.`);
    }
  }
  const keys = new Set();
  if (!Array.isArray(config.environment) || config.environment.length > 64) {
    fail('environment', 'Use at most 64 environment variables.');
  } else {
    for (const entry of config.environment) {
      if (!entry || typeof entry.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key) || entry.key.length > 255) fail('environment', 'Environment names must start with a letter or underscore and contain only letters, numbers and underscores (up to 255 characters).');
      if (!entry || !clean(entry.value) || entry.value.length > 4096) fail('environment', 'Environment values must not contain control characters and must be at most 4096 characters.');
      if (entry && keys.has(entry.key)) fail('environment', `Duplicate environment name: ${entry.key}.`);
      if (entry) keys.add(entry.key);
    }
  }
  if (errors.length) return { errors, unit: '', filename: '' };

  const lines = ['[Unit]', `Description=${literal(config.description)}`];
  for (const [field, directive] of [['after', 'After'], ['wants', 'Wants'], ['requires', 'Requires']]) {
    if (dependencies[field].length) lines.push(`${directive}=${dependencies[field].join(' ')}`);
  }
  lines.push(`StartLimitIntervalSec=${config.startLimitInterval}s`, `StartLimitBurst=${config.startLimitBurst}`, '', '[Service]', `Type=${config.type}`);
  if (config.mode === 'system') {
    lines.push(`User=${config.user}`);
    if (config.group) lines.push(`Group=${config.group}`);
  }
  if (config.workingDirectory) lines.push(`WorkingDirectory=${literal(config.workingDirectory)}`);
  for (const { key, value } of config.environment) lines.push(`Environment=${quote(`${key}=${value}`)}`);
  if (config.environmentFile) lines.push(`EnvironmentFile=${literal(config.environmentFile)}`);
  // ':' disables environment expansion; quoting preserves each argument, including ";" and "".
  lines.push(`ExecStart=:${[quote(config.executable), ...config.args.map(quote)].join(' ')}`);
  if (config.type === 'oneshot' && config.remainAfterExit) lines.push('RemainAfterExit=yes');
  lines.push(`Restart=${config.restart}`, `RestartSec=${config.restartSec}s`, `TimeoutStartSec=${config.timeoutStart}s`, `TimeoutStopSec=${config.timeoutStop}s`, 'StandardOutput=journal', 'StandardError=journal');
  if (config.mode === 'system') {
    for (const [field, directive] of [['noNewPrivileges', 'NoNewPrivileges=yes'], ['privateTmp', 'PrivateTmp=yes'], ['protectSystem', 'ProtectSystem=full'], ['protectHome', 'ProtectHome=read-only']]) {
      if (config[field]) lines.push(directive);
    }
  }
  lines.push('', '[Install]', `WantedBy=${config.mode === 'user' ? 'default.target' : 'multi-user.target'}`, '');
  return { errors: [], unit: lines.join('\n'), filename: `${config.name}.service` };
}

export function installGuide(config) {
  const file = `${config.name}.service`;
  const user = config.mode === 'user';
  const ctl = user ? 'systemctl --user' : 'sudo systemctl';
  return [
    { title: '1. Review and verify', text: 'On Ubuntu, open a terminal in the download folder. Review the unit in an editor. Confirm the executable and accounts exist, and check ownership and permissions for every path. Optionally check syntax:', code: `systemd-analyze ${user ? '--user ' : ''}verify "./${file}"`, note: 'Verification may report missing executables, environment files, dependencies or user-manager/session resources. Resolve warnings on the target host. It does not run the service or prove startup will succeed.' },
    { title: '2. Install without overwriting', text: `First inspect existing units with ${ctl} cat ${file} and ${ctl} show -p FragmentPath ${file}. "Not found" is expected for a new unit; investigate other errors. If a unit already exists anywhere in the load path, stop and review/back it up before intentional changes. The copy below refuses to overwrite an existing destination.`, code: user
      ? `mkdir -p "$HOME/.config/systemd/user"\n( set -C; cat "./${file}" > "$HOME/.config/systemd/user/${file}" )`
      : `sudo install -d -m 0755 /etc/systemd/system\nsudo sh -c 'set -C; cat > "/etc/systemd/system/${file}"' < "./${file}"`, note: 'Continue only after the copy succeeds. Do not blindly delete an existing file. New files use the shell/root umask; inspect ownership and permissions (typically 0644, owned by you for user units or root for system units). Unit files are not secret storage.' },
    { title: '3. Reload, start, and inspect', text: 'Reloading discovers the file. Starting is a separate, deliberate operation. Inspect status and logs even if start returns successfully.', code: `${ctl} daemon-reload\n${ctl} start ${file}\n${ctl} status ${file}\n${user ? 'journalctl --user' : 'sudo journalctl'} -u ${file} -n 50 --no-pager`, note: user ? 'Run as the intended login account, not with sudo. User services need a user manager and normally stop after the last session ends. Lingering can keep the manager running after logout and at boot; it is an administrator lifecycle/security decision. This app never enables lingering.' : 'The selected account must be able to read the application/configuration and traverse its directories. Do not solve permissions errors by granting root privileges unnecessarily.' },
    { title: '4. Enable only when ready', text: `Enable links this unit to ${user ? 'your user manager’s default target' : 'the system’s multi-user target'} for future starts. It does not start it immediately. enable --now would do both.`, code: `${ctl} enable ${file}\n\n# Stop now and prevent future automatic starts:\n${ctl} stop ${file}\n${ctl} disable ${file}`, note: `Disable removes enablement links, not the file, and does not prevent manual/dependency starts. Stop alone does not disable it. If a start limit is reached, fix the cause and inspect logs before running ${ctl} reset-failed ${file}.` },
  ];
}
