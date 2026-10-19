import { defaults, generate, installGuide, preset } from './generator.js';

const byId = id => document.getElementById(id);
const form = byId('service-form');
const scalarFields = Object.keys(defaults()).filter(key => !['args', 'environment'].includes(key));
let result;

function readConfig() {
  const config = defaults();
  for (const key of scalarFields) {
    const input = byId(key);
    config[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  config.args = [...byId('arguments').querySelectorAll('input')].map(input => input.value);
  config.environment = [...byId('environment').children].map(row => ({
    key: row.querySelector('[data-key]').value,
    value: row.querySelector('[data-value]').value,
  }));
  return config;
}

function makeInput(label, value, attribute) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  if (attribute) input.setAttribute(attribute, '');
  return input;
}

function addRow(kind, values = {}, focus = true) {
  const container = byId(kind);
  const row = document.createElement('div');
  row.className = kind === 'arguments' ? 'argument-row' : 'environment-row';
  const number = container.children.length + 1;
  if (kind === 'arguments') {
    row.append(makeInput(`Argument ${number}`, values.value ?? ''));
  } else {
    row.append(makeInput(`Variable ${number} name`, values.key ?? '', 'data-key'));
    row.append(makeInput(`Variable ${number} value`, values.value ?? '', 'data-value'));
    row.children[0].placeholder = 'NAME';
    row.children[1].placeholder = 'Literal value';
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-button';
  remove.textContent = '\u00d7';
  remove.setAttribute('aria-label', `Remove ${kind === 'arguments' ? 'argument' : 'variable'} ${number}`);
  remove.addEventListener('click', () => {
    row.remove();
    [...container.children].forEach((child, index) => {
      const inputs = child.querySelectorAll('input');
      inputs[0].setAttribute('aria-label', kind === 'arguments' ? `Argument ${index + 1}` : `Variable ${index + 1} name`);
      if (inputs[1]) inputs[1].setAttribute('aria-label', `Variable ${index + 1} value`);
      child.querySelector('button').setAttribute('aria-label', `Remove ${kind === 'arguments' ? 'argument' : 'variable'} ${index + 1}`);
    });
    byId(kind === 'arguments' ? 'add-argument' : 'add-environment').focus();
    update();
  });
  row.append(remove);
  container.append(row);
  if (focus) row.querySelector('input').focus();
}

function setConfig(config) {
  for (const key of scalarFields) {
    const input = byId(key);
    if (input.type === 'checkbox') input.checked = config[key];
    else input.value = config[key];
  }
  byId('arguments').replaceChildren();
  byId('environment').replaceChildren();
  config.args.forEach(value => addRow('arguments', { value }, false));
  config.environment.forEach(value => addRow('environment', value, false));
  update();
}

function renderInstructions(config) {
  const container = byId('instructions');
  container.replaceChildren();
  if (result.errors.length) {
    const note = document.createElement('p');
    note.textContent = 'Fix the configuration errors to see installation commands for this unit.';
    container.append(note);
    return;
  }
  for (const step of installGuide(config)) {
    const article = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = step.title;
    const text = document.createElement('p');
    text.textContent = step.text;
    const pre = document.createElement('pre');
    pre.tabIndex = 0;
    const code = document.createElement('code');
    code.textContent = step.code;
    pre.append(code);
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = step.note;
    article.append(title, text, pre, note);
    container.append(article);
  }
}

function update() {
  const config = readConfig();
  const system = config.mode === 'system';
  const oneshot = config.type === 'oneshot';
  byId('system-fields').hidden = !system;
  byId('hardening-fields').hidden = !system;
  byId('user').required = system;
  byId('oneshot-fields').hidden = !oneshot;
  byId('mode-hint').textContent = system
    ? 'Machine-wide unit. Installation uses sudo; the process runs as the existing account you choose below.'
    : 'Runs as your current account, without sudo. Usually stops after your last login session ends.';
  byId('type-hint').textContent = oneshot
    ? 'Waits until the task exits. The start timeout covers its whole run. Choose Never for a one-time task, or On failure to retry failures.'
    : `${config.type === 'exec' ? 'exec catches a missing executable/account at start time.' : 'simple may report start success even if the executable cannot run.'} Neither confirms application readiness. Keep the process in the foreground; do not daemonize.`;
  result = generate(config);
  byId('preview').textContent = result.errors.length ? '# Resolve the configuration errors below.\n# Export is disabled until the unit is valid.\n' : result.unit;
  byId('filename').textContent = result.filename || 'configuration needs attention';
  byId('valid-badge').textContent = result.errors.length ? 'Needs attention' : 'Ready to review';
  byId('valid-badge').classList.toggle('invalid', result.errors.length > 0);
  byId('download').disabled = result.errors.length > 0;
  byId('copy').disabled = result.errors.length > 0;
  byId('status').textContent = '';
  byId('manual-copy').hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach(input => {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
  });
  const errorBox = byId('errors');
  errorBox.replaceChildren();
  errorBox.hidden = result.errors.length === 0;
  if (result.errors.length) {
    const heading = document.createElement('strong');
    heading.textContent = 'A few things need attention';
    const list = document.createElement('ul');
    result.errors.forEach((error, index) => {
      const item = document.createElement('li');
      item.id = `error-${index}`;
      const link = document.createElement('a');
      link.href = `#${error.field}`;
      link.textContent = error.message;
      link.addEventListener('click', event => {
        event.preventDefault();
        const target = byId(error.field);
        const details = target.closest('details');
        if (details) details.open = true;
        const input = target.matches('input, select') ? target : target.querySelector('input');
        if (input) input.focus();
        else target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      const target = byId(error.field);
      const inputs = target.matches('input, select') ? [target] : target.querySelectorAll('input');
      inputs.forEach(input => {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-errormessage', item.id);
      });
      item.append(link);
      list.append(item);
    });
    errorBox.append(heading, list);
  }
  renderInstructions(config);
}

form.addEventListener('input', event => {
  if (event.target.id === 'type' && event.target.value !== 'oneshot') byId('remainAfterExit').checked = false;
  update();
});
form.addEventListener('submit', event => event.preventDefault());
byId('add-argument').addEventListener('click', () => { addRow('arguments'); update(); });
byId('add-environment').addEventListener('click', () => { addRow('environment'); update(); });
document.querySelectorAll('[data-preset]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-preset]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    setConfig(preset(button.dataset.preset));
    byId('status').textContent = 'Recipe loaded. Customize the example paths for your machine.';
  });
});
byId('download').addEventListener('click', () => {
  update();
  if (result.errors.length) return;
  const url = URL.createObjectURL(new Blob([result.unit], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  byId('status').textContent = `Download requested: ${result.filename}. Review it before installing.`;
});
byId('copy').addEventListener('click', async () => {
  update();
  if (result.errors.length) return;
  const unit = result.unit;
  try {
    await navigator.clipboard.writeText(unit);
    byId('status').textContent = 'Unit copied to clipboard.';
  } catch {
    const manual = byId('manual-copy');
    manual.value = unit;
    manual.hidden = false;
    manual.focus();
    manual.select();
    byId('status').textContent = 'Clipboard access failed. The unit is selected in the manual-copy box: use your browser copy command, or download the file.';
  }
});
setConfig(defaults());
