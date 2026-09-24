'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  info: null,
  busy: false,
  result: null,
  lastOperation: null,
  selectedFile: null,
  template: null,
  templateFormat: 'php',
  templateRequest: 0,
  savingTemplate: false,
  ideSdkPath: null,
  outputPath: null,
  toastTimer: null,
};
const reverseState = { result: null, lastOperation: null, selectedFile: null, outputPath: null };
const reverseMetricLabels = [['tables', '表'], ['columns', '列'], ['sequences', '序列'], ['indexes', '索引'], ['foreignKeys', '外键'], ['seedRows', '初始数据'], ['drops', '删除声明']];
const pageDetails = {
  workspace: ['转换工作台', '用 PHP 编写结构与初始数据，转换为 PostgreSQL SQL。'],
  reverse: ['SQL → PHP', '从指定的 SQL 文件生成 PHP 迁移，一份 SQL 对应一份 PHP。'],
  templates: ['迁移模板', '使用支持的 Schema 写法，编写可重复转换的 PHP 迁移。'],
  integration: ['AI 接入', '连接本地 MCP 服务，让 AI 按迁移规范编写、检查和转换。'],
};
const fileStatusLabels = {
  new: '待生成', pending: '待生成', ready: '待生成',
  unchanged: '未变更', skipped: '未变更', existing: '内容一致',
  changed: '待更新', replace: '待替换', updated: '已更新', written: '已生成', generated: '已生成',
  error: '转换失败', failed: '转换失败', blocked: '已阻断',
};

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

function showNotice(message, kind = 'info') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = !message;
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function toast(message) {
  clearTimeout(state.toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

function operationStatus(message, busy = false, scope = 'workspace') {
  const status = $(scope === 'reverse' ? 'reverse-operation-status' : 'operation-status');
  status.lastElementChild.textContent = message;
  status.classList.toggle('busy', busy);
}

function setBusy(busy, message, scope = 'workspace') {
  state.busy = busy;
  for (const id of ['conversion-form', 'reverse-form']) {
    for (const control of $(id).querySelectorAll('input, select, textarea, button')) control.disabled = busy;
    $(id).setAttribute('aria-busy', String(busy));
  }
  $('preview-button').textContent = busy && message === '正在预览…' ? '正在预览…' : '预览转换';
  $('convert-button').lastElementChild.textContent = busy && message === '正在生成…' ? '正在生成…' : '生成 SQL';
  $('reverse-preview-button').textContent = busy && message === '正在解析 SQL…' ? '正在预览…' : '预览 PHP';
  $('reverse-convert-button').lastElementChild.textContent = busy && message === '正在生成 PHP…' ? '正在生成…' : '生成 PHP';
  if (message) operationStatus(message, busy, scope);
  if (!busy) {
    $('operation-status').classList.remove('busy');
    $('reverse-operation-status').classList.remove('busy');
  }
  $('open-output').disabled = busy || !state.outputPath;
  $('reverse-open-output').disabled = busy || !reverseState.outputPath;
  for (const id of ['ide-sdk-project-dir', 'choose-ide-sdk-project', 'export-ide-sdk']) {
    $(id).disabled = busy || !state.info?.ideSdk || typeof window.studio?.exportIdeSdk !== 'function';
  }
  $('open-ide-sdk').disabled = busy || !state.ideSdkPath;
}

function setPage(page) {
  if (!pageDetails[page]) return;
  showNotice('');
  for (const button of document.querySelectorAll('[data-page]')) {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll('.page-view')) section.hidden = section.id !== `page-${page}`;
  $('page-title').textContent = pageDetails[page][0];
  $('page-description').textContent = pageDetails[page][1];
  if (page === 'templates' && !state.template && state.info?.templates?.length) {
    loadTemplate(state.info.templates[0].id);
  }
}

function invalidatePreview() {
  if (!state.result) return;
  state.result = null;
  state.selectedFile = null;
  state.outputPath = null;
  $('file-filter').value = '';
  $('diagnostics').hidden = true;
  $('open-output').disabled = true;
  renderFiles();
  renderSql();
  $('result-summary').replaceChildren(element('span', '', '设置已变更，请重新预览'));
  operationStatus('设置已变更，请重新预览');
  showNotice('');
}

function updateGuard() {
  const enabled = $('guard').checked;
  $('guard-description').textContent = enabled
    ? '对比上次成功转换记录；PHP 或 SQL 被修改、删除时中断，新文件可追加。'
    : '关闭后允许重新生成；被替换的 SQL 和旧记录会备份，不自动删除孤立 SQL。';
  $('guard').closest('.guard-field').classList.toggle('guard-off', !enabled);
}

function readOptions() {
  let config;
  try {
    config = JSON.parse($('config-json').value);
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('配置必须是 JSON 对象，例如 {"permission.database.table": "rules"}。');
    }
  } catch (error) {
    $('config-error').textContent = `配置 JSON 无效：${messageOf(error)}`;
    $('config-error').hidden = false;
    $('config-json').setAttribute('aria-invalid', 'true');
    $('config-json').closest('details').open = true;
    $('config-json').focus();
    throw new Error('请修正动态配置映射中的 JSON。');
  }
  $('config-error').hidden = true;
  $('config-json').removeAttribute('aria-invalid');
  for (const [id, title] of [['input-dir', 'Migrations 文件夹'], ['output-dir', 'SQL 输出文件夹']]) {
    if (!$(id).value.trim()) {
      $(id).focus();
      throw new Error(`请选择或填写${title}路径。`);
    }
  }
  return {
    inputDir: $('input-dir').value.trim(),
    outputDir: $('output-dir').value.trim(),
    targetVersion: Number($('target-version').value),
    guard: $('guard').checked,
    config,
  };
}

async function chooseDirectory(kind, fieldId) {
  if (state.busy) return;
  const reverse = kind === 'reverse-output';
  const status = $(reverse ? 'reverse-operation-status' : 'operation-status').lastElementChild.textContent;
  let changed = false;
  setBusy(true, '正在选择文件夹…', reverse ? 'reverse' : 'workspace');
  try {
    const path = await window.studio.chooseDirectory(kind);
    if (path) {
      $(fieldId).value = path;
      if (reverse) invalidateReversePreview();
      else invalidatePreview();
      $(fieldId).title = path;
      changed = true;
    }
  } catch (error) {
    showNotice(`无法选择文件夹：${messageOf(error)}`, 'error');
  } finally {
    setBusy(false, changed ? '路径已更新，请重新预览' : status, reverse ? 'reverse' : 'workspace');
  }
}

async function runConversion(mode) {
  if (state.busy) return;
  let options;
  try { options = readOptions(); }
  catch (error) { showNotice(messageOf(error), 'error'); return; }
  showNotice('');
  setBusy(true, mode === 'preview' ? '正在预览…' : '正在生成…');
  try {
    const result = await window.studio[mode](options);
    if (!result || typeof result.ok !== 'boolean' || !Array.isArray(result.files)) {
      throw new Error('转换引擎返回了无法识别的结果。');
    }
    state.result = result;
    state.lastOperation = mode;
    state.selectedFile = result.files.find((file) => file.sourceName === state.selectedFile?.sourceName) || result.files[0] || null;
    state.outputPath = mode === 'convert' && result.ok ? options.outputDir : null;
    $('file-filter').value = '';
    renderSummary(result, mode);
    renderFiles();
    renderSql();
    renderDiagnostics(result);
    if (!result.ok) {
      showNotice('转换已中断。请根据下方诊断处理相关文件后重试。', 'error');
      operationStatus('已中断，请处理诊断');
    } else if (mode === 'preview') {
      operationStatus(result.files.length ? '预览完成，尚未写入文件' : '未找到 PHP migration 文件');
      if (result.files.some((file) => file.summary?.destructive)) showNotice('预览涉及已有对象的删除或变更，请检查下方具体提示。本工具尚未执行任何 SQL。');
      if (!result.files.length) showNotice('当前文件夹没有可转换的 PHP migration 文件，请检查输入路径。');
    } else {
      const destructive = result.files.some((file) => file.summary?.destructive);
      const message = `转换完成：写入 ${result.written || 0} 个，跳过 ${result.skipped || 0} 个文件。${destructive ? ' SQL 含已有对象的删除或变更，尚未执行到数据库。' : ''}`;
      showNotice(result.backupDir ? `${message} 备份目录：${result.backupDir}` : message, 'success');
      operationStatus('SQL 文件已生成');
    }
  } catch (error) {
    state.result = null;
    state.selectedFile = null;
    state.outputPath = null;
    renderFiles();
    renderSql();
    $('diagnostics').hidden = true;
    $('result-summary').replaceChildren(element('span', '', '操作未完成'));
    operationStatus('操作未完成，请查看错误信息');
    showNotice(`操作失败：${messageOf(error)}`, 'error');
  } finally {
    setBusy(false);
  }
}

function renderSummary(result, mode) {
  const warningCount = result.files.reduce((count, file) => count + (file.warnings?.length || 0), 0);
  const values = [[result.files.length, '个文件']];
  const seedRows = result.files.reduce((count, file) => count + (file.summary?.seedRows || 0), 0);
  const destructiveFiles = result.files.filter((file) => file.summary?.destructive).length;
  if (seedRows) values.push([seedRows, '条待插入数据']);
  if (destructiveFiles) values.push([destructiveFiles, '个含删除/变更']);
  if (mode === 'convert' && result.ok) values.push([result.written || 0, '已写入'], [result.skipped || 0, '跳过']);
  if (warningCount) values.push([warningCount, '条提示']);
  if (!result.ok) values.push([result.diagnostics?.length || 1, '项问题']);
  $('result-summary').replaceChildren(...values.map(([count, label]) => {
    const item = element('span');
    item.append(element('strong', '', count), document.createTextNode(label));
    return item;
  }));
}

function renderFiles() {
  const files = state.result?.files || [];
  const filter = $('file-filter').value.trim().toLocaleLowerCase();
  const filtered = files.filter((file) => `${file.sourceName} ${file.outputName}`.toLocaleLowerCase().includes(filter));
  $('file-count').textContent = files.length;
  $('file-filter').disabled = !files.length;
  $('file-empty').hidden = filtered.length > 0;
  $('file-list').hidden = !filtered.length;
  $('file-empty').querySelector('p').textContent = files.length ? '没有匹配的文件' : '还没有转换记录';
  $('file-empty').querySelector('span').textContent = files.length ? '试试其他文件名或清空搜索' : '选择文件夹后点击「预览转换」';
  $('file-list').replaceChildren(...filtered.map((file) => {
    const item = element('li');
    const button = element('button', 'file-item');
    button.type = 'button';
    button.classList.toggle('selected', file === state.selectedFile);
    button.setAttribute('aria-pressed', String(file === state.selectedFile));
    button.title = file.sourceName;
    const body = element('div');
    const metadata = element('div', 'file-meta');
    const statusClass = ['unchanged', 'skipped', 'existing'].includes(file.status) ? 'unchanged'
      : ['error', 'failed', 'blocked'].includes(file.status) ? 'failed' : '';
    const completed = state.lastOperation === 'convert' && state.result.ok;
    const statusLabel = completed && file.status === 'new' ? '已生成'
      : completed && file.status === 'replace' ? '已更新'
        : fileStatusLabels[file.status] || file.status || '已解析';
    metadata.append(element('span', `file-state ${statusClass}`, statusLabel));
    if (file.summary?.seedRows) metadata.append(element('span', '', `${file.summary.seedRows} 条初始数据`));
    if (file.summary?.destructive) metadata.append(element('span', 'file-state failed', '含删除/变更'));
    if (file.warnings?.length) metadata.append(element('span', 'file-warning-count', `${file.warnings.length} 条提示`));
    body.append(element('span', 'file-name', file.sourceName), metadata);
    button.append(icon('file'), body);
    button.addEventListener('click', () => {
      state.selectedFile = file;
      for (const entry of $('file-list').querySelectorAll('button')) {
        const selected = entry === button;
        entry.classList.toggle('selected', selected);
        entry.setAttribute('aria-pressed', String(selected));
      }
      renderSql();
    });
    item.append(button);
    return item;
  }));
  $('file-panel-footer').textContent = files.length
    ? `${filtered.length} / ${files.length} 个文件 · 结构与初始数据`
    : '支持 up()、静态 data() 与 exists_drop';
}

function renderSql() {
  const file = state.selectedFile;
  const hasSql = Boolean(file && typeof file.sql === 'string' && file.sql.length);
  $('sql-preview').hidden = !hasSql;
  $('sql-empty').hidden = hasSql;
  $('sql-content').textContent = hasSql ? file.sql : '';
  $('sql-filename').textContent = file?.outputName || '预览';
  $('sql-filename').title = file?.outputName || '';
  $('sql-source').textContent = file?.sourceName || '尚未选择文件';
  $('sql-source').title = file?.sourceName || '';
  $('sql-line-count').textContent = hasSql ? `${file.sql.trimEnd().split('\n').length} 行 · UTF-8` : 'UTF-8';
  $('copy-sql').disabled = !hasSql;
  $('sql-preview').scrollTop = 0;
  $('sql-preview').scrollLeft = 0;
}

function renderDiagnostics(result, prefix = '') {
  const items = [];
  for (const diagnostic of result.diagnostics || []) {
    items.push({ ...diagnostic, level: diagnostic.severity || (result.ok ? 'warning' : 'error') });
  }
  for (const file of result.files) {
    for (const warning of file.warnings || []) {
      items.push({ ...warning, file: file.sourceName, level: 'warning' });
    }
  }
  const hasErrors = items.some((item) => item.level === 'error');
  $(`${prefix}diagnostics`).hidden = !items.length;
  $(`${prefix}diagnostics`).classList.toggle('has-errors', hasErrors);
  $(`${prefix}diagnostics-title`).textContent = hasErrors ? '需要处理的问题' : '转换提示';
  $(`${prefix}diagnostic-list`).replaceChildren(...items.map((diagnostic) => {
    const row = element('li', `diagnostic-item ${diagnostic.level}`);
    const body = element('div', 'diagnostic-body');
    body.append(document.createTextNode(diagnostic.message || '未知诊断'));
    if (diagnostic.code) body.append(element('span', 'diagnostic-code', diagnostic.code));
    if (diagnostic.file || diagnostic.line) {
      const location = [diagnostic.file, diagnostic.line ? `第 ${diagnostic.line} 行` : ''].filter(Boolean).join(' · ');
      body.append(element('div', 'diagnostic-location', location));
    }
    row.append(element('span', 'diagnostic-level', diagnostic.level === 'error' ? '错误' : '提示'), body);
    return row;
  }));
}

function reverseSourceFiles() {
  return $('reverse-source-files').value.split(/\r?\n/).map((line) => {
    const value = line.trim();
    return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).trim() : value;
  }).filter(Boolean);
}

function updateReverseInputCount() {
  const count = reverseSourceFiles().length;
  $('reverse-input-count').textContent = count ? `已列出 ${count} 个 SQL 文件` : '尚未选择文件';
}

function updateReverseGuard() {
  const enabled = $('reverse-guard').checked;
  $('reverse-guard-description').textContent = enabled
    ? '对比上次记录的源 SQL 与输出 PHP；修改、删除时中断，新文件可追加。'
    : '关闭后允许重新生成；先备份被替换的 PHP 与旧记录，不修改源 SQL。';
  $('reverse-guard').closest('.guard-field').classList.toggle('guard-off', !enabled);
}

function invalidateReversePreview() {
  if (!reverseState.result) return;
  reverseState.result = null;
  reverseState.selectedFile = null;
  reverseState.outputPath = null;
  $('reverse-file-filter').value = '';
  $('reverse-diagnostics').hidden = true;
  $('reverse-analysis').hidden = true;
  $('reverse-open-output').disabled = true;
  $('reverse-result-summary').replaceChildren(element('span', '', '设置已变更，请重新预览'));
  renderReverseFiles();
  renderReversePhp();
  operationStatus('设置已变更，请重新预览', false, 'reverse');
  showNotice('');
}

async function chooseSqlFiles() {
  if (state.busy) return;
  const previousStatus = $('reverse-operation-status').lastElementChild.textContent;
  let changed = false;
  setBusy(true, '正在选择 SQL 文件…', 'reverse');
  try {
    const files = await window.studio.chooseSqlFiles();
    if (Array.isArray(files) && files.length) {
      $('reverse-source-files').value = files.join('\n');
      invalidateReversePreview();
      updateReverseInputCount();
      changed = true;
    }
  } catch (error) {
    showNotice(`无法选择 SQL 文件：${messageOf(error)}。也可以在列表中手动填写文件路径。`, 'error');
  } finally {
    setBusy(false, changed ? '文件列表已更新，请预览 PHP' : previousStatus, 'reverse');
  }
}

function readReverseOptions() {
  const sourceFiles = reverseSourceFiles();
  if (!sourceFiles.length) {
    $('reverse-source-files').focus();
    throw new Error('请选择 SQL 文件，或每行填写一个 SQL 文件的绝对路径。');
  }
  const seen = new Set();
  for (const file of sourceFiles) {
    if (!/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+[\\/])/i.test(file) || !/\.sql$/i.test(file)) {
      $('reverse-source-files').focus();
      throw new Error(`SQL 文件需使用以 .sql 结尾的 Windows 绝对路径：${file}`);
    }
    const key = file.replaceAll('/', '\\').toLocaleLowerCase();
    if (seen.has(key)) {
      $('reverse-source-files').focus();
      throw new Error(`列表中重复填写了 SQL 文件：${file}`);
    }
    seen.add(key);
  }
  if (!$('reverse-output-dir').value.trim()) {
    $('reverse-output-dir').focus();
    throw new Error('请选择或填写 PHP 输出文件夹路径。');
  }
  return {
    sourceFiles,
    outputDir: $('reverse-output-dir').value.trim(),
    targetVersion: Number($('reverse-target-version').value),
    guard: $('reverse-guard').checked,
  };
}

async function runReverseConversion(mode) {
  if (state.busy) return;
  let options;
  try { options = readReverseOptions(); }
  catch (error) { showNotice(messageOf(error), 'error'); return; }
  showNotice('');
  setBusy(true, mode === 'preview' ? '正在解析 SQL…' : '正在生成 PHP…', 'reverse');
  try {
    const result = await window.studio[mode === 'preview' ? 'previewReverse' : 'convertReverse'](options);
    if (!result || typeof result.ok !== 'boolean' || !Array.isArray(result.files)) {
      throw new Error('SQL → PHP 引擎返回了无法识别的结果。');
    }
    reverseState.result = result;
    reverseState.lastOperation = mode;
    const previous = reverseState.selectedFile;
    reverseState.selectedFile = result.files.find((file) =>
      (file.sourcePath || file.sourceName) === (previous?.sourcePath || previous?.sourceName)) || result.files[0] || null;
    reverseState.outputPath = mode === 'convert' && result.ok ? options.outputDir : null;
    $('reverse-file-filter').value = '';
    renderReverseSummary(result, mode, options.sourceFiles.length);
    renderReverseFiles();
    renderReversePhp();
    const verificationDiagnostics = [];
    if (result.ok) for (const file of result.files) {
      if (file.verification?.semanticEqual !== true) verificationDiagnostics.push({
        code: file.verification?.semanticEqual === false ? 'ROUNDTRIP_MISMATCH' : 'ROUNDTRIP_UNCONFIRMED',
        message: file.verification?.semanticEqual === false ? '往返语义校验失败，请检查转换结果。' : '未收到往返语义校验通过的证据。',
        severity: file.verification?.semanticEqual === false ? 'error' : 'warning',
        file: file.sourceName,
      });
      if (!hasReverseSummary(file)) verificationDiagnostics.push({
        code: 'SUMMARY_UNCONFIRMED', message: '转换统计不完整，表、列、序列、索引、外键、初始数据或删除声明数量待核验。', severity: 'warning', file: file.sourceName,
      });
    }
    renderDiagnostics({ ...result, diagnostics: [...(result.diagnostics || []), ...verificationDiagnostics] }, 'reverse-');
    const verified = result.files.length === options.sourceFiles.length && result.files.every((file) => file.verification?.semanticEqual === true && hasReverseSummary(file));
    if (!result.ok) {
      showNotice('SQL → PHP 转换已中断，请根据诊断处理相关文件。不支持的 SQL 语法不会被静默跳过。', 'error');
      operationStatus('已中断，请处理诊断', false, 'reverse');
    } else if (mode === 'preview') {
      operationStatus(verified ? '预览完成，往返校验通过；尚未写入 PHP' : '预览已返回，部分统计或往返校验待核验', false, 'reverse');
      if (!result.files.length) showNotice('没有返回可转换文件，请检查 SQL 文件列表。', 'error');
      else if (!verified) showNotice('预览尚未获得全部文件的完整统计与往返校验证据，请检查下方结果与诊断。');
    } else {
      const message = `PHP 输出完成：写入 ${result.written ?? '未知'} 个，跳过 ${result.skipped ?? '未知'} 个文件。${verified ? '往返语义校验通过。' : '统计或往返校验尚未全部确认，请检查结果。'}`;
      showNotice(result.backupDir ? `${message} 备份目录：${result.backupDir}` : message, verified ? 'success' : 'info');
      operationStatus(verified ? 'PHP 文件已生成，往返校验通过' : 'PHP 输出已返回，请检查校验状态', false, 'reverse');
    }
  } catch (error) {
    reverseState.result = null;
    reverseState.selectedFile = null;
    reverseState.outputPath = null;
    renderReverseFiles();
    renderReversePhp();
    $('reverse-diagnostics').hidden = true;
    $('reverse-analysis').hidden = true;
    $('reverse-result-summary').replaceChildren(element('span', '', '操作未完成'));
    operationStatus('操作未完成，请查看错误信息', false, 'reverse');
    showNotice(`SQL → PHP 操作失败：${messageOf(error)}`, 'error');
  } finally {
    setBusy(false);
  }
}

function verificationText(file) {
  if (file.verification?.semanticEqual === true) return '往返校验通过';
  if (file.verification?.semanticEqual === false) return '往返校验失败';
  return '往返校验待核验';
}

function hasReverseSummary(file) {
  return reverseMetricLabels.every(([key]) => Number.isInteger(file.summary?.[key]) && file.summary[key] >= 0);
}

function renderReverseSummary(result, mode, requestedCount) {
  const files = result.files;
  const values = [[`${files.length}/${requestedCount}`, '个已解析文件']];
  if (mode === 'convert' && result.ok) values.push([result.written ?? '—', '已写入'], [result.skipped ?? '—', '跳过']);
  if (!result.ok) values.push([result.diagnostics?.length || 1, '项问题']);
  $('reverse-result-summary').replaceChildren(...values.map(([count, label]) => {
    const item = element('span');
    item.append(element('strong', '', count), document.createTextNode(label));
    return item;
  }));
  $('reverse-metrics').replaceChildren(...reverseMetricLabels.map(([key, label]) => {
    const complete = files.length > 0 && files.every((file) => Number.isInteger(file.summary?.[key]) && file.summary[key] >= 0);
    const metric = element('div');
    metric.append(element('dt', '', label), element('dd', complete ? '' : 'metric-unknown', complete
      ? files.reduce((total, file) => total + file.summary[key], 0).toLocaleString('zh-CN') : '待核验'));
    return metric;
  }));
  const passed = files.filter((file) => file.verification?.semanticEqual === true).length;
  const failed = files.filter((file) => file.verification?.semanticEqual === false).length;
  const verified = passed === requestedCount && files.length === requestedCount;
  const summaryComplete = files.length > 0 && files.every(hasReverseSummary);
  $('reverse-verification').textContent = verified ? `往返校验通过 · ${passed} 个文件${summaryComplete ? '' : ' · 统计待核验'}`
    : failed ? `往返校验失败 · ${failed} 个文件` : `往返校验待完成 · ${passed}/${requestedCount} 个通过`;
  $('reverse-verification').className = `verification-state ${verified && summaryComplete ? 'verified' : failed ? 'failed' : 'unverified'}`;
  $('reverse-analysis').hidden = false;
}

function renderReverseFiles() {
  const files = reverseState.result?.files || [];
  const filter = $('reverse-file-filter').value.trim().toLocaleLowerCase();
  const filtered = files.filter((file) => `${file.sourceName} ${file.sourcePath || ''} ${file.outputName}`.toLocaleLowerCase().includes(filter));
  $('reverse-file-count').textContent = files.length;
  $('reverse-file-filter').disabled = !files.length;
  $('reverse-file-empty').hidden = filtered.length > 0;
  $('reverse-file-list').hidden = !filtered.length;
  $('reverse-file-empty').querySelector('p').textContent = files.length ? '没有匹配的文件' : '还没有转换记录';
  $('reverse-file-empty').querySelector('span').textContent = files.length ? '试试其他文件名或清空搜索' : '选择 SQL 文件后点击「预览 PHP」';
  $('reverse-file-list').replaceChildren(...filtered.map((file) => {
    const item = element('li');
    const button = element('button', 'file-item');
    button.type = 'button';
    button.classList.toggle('selected', file === reverseState.selectedFile);
    button.setAttribute('aria-pressed', String(file === reverseState.selectedFile));
    button.title = file.sourcePath || file.sourceName;
    const body = element('div');
    const metadata = element('div', 'file-meta');
    const completed = reverseState.lastOperation === 'convert' && reverseState.result.ok;
    const status = completed && file.status === 'new' ? '已生成'
      : completed && file.status === 'replace' ? '已更新' : fileStatusLabels[file.status] || '已解析';
    metadata.append(element('span', 'file-state', status));
    if (file.warnings?.length) metadata.append(element('span', 'file-warning-count', `${file.warnings.length} 条提示`));
    const verification = element('span', `file-verification ${file.verification?.semanticEqual === true ? 'verified' : file.verification?.semanticEqual === false ? 'failed' : 'unverified'}`, verificationText(file));
    body.append(element('span', 'file-name', file.sourceName), metadata, verification);
    button.append(icon('file'), body);
    button.addEventListener('click', () => {
      reverseState.selectedFile = file;
      for (const entry of $('reverse-file-list').querySelectorAll('button')) {
        const selected = entry === button;
        entry.classList.toggle('selected', selected);
        entry.setAttribute('aria-pressed', String(selected));
      }
      renderReversePhp();
    });
    item.append(button);
    return item;
  }));
  $('reverse-file-panel-footer').textContent = files.length
    ? `${filtered.length} / ${files.length} 个文件 · 一份 SQL 对应一份 PHP` : '每份 SQL 生成一个 PHP migration';
}

function renderReversePhp() {
  const file = reverseState.selectedFile;
  const hasPhp = Boolean(file && typeof file.php === 'string' && file.php.length);
  $('reverse-php-preview').hidden = !hasPhp;
  $('reverse-php-empty').hidden = hasPhp;
  // 只渲染选中文件，避免将整批大型 PHP 文本同时放入 DOM。
  $('reverse-php-content').textContent = hasPhp ? file.php : '';
  $('reverse-php-filename').textContent = file?.outputName || '预览';
  $('reverse-php-filename').title = file?.outputName || '';
  $('reverse-php-source').textContent = file?.sourceName || '尚未选择文件';
  $('reverse-php-source').title = file?.sourcePath || file?.sourceName || '';
  $('reverse-copy-php').disabled = !hasPhp;
  let lines = 0;
  if (hasPhp) {
    lines = 1;
    for (let index = 0; index < file.php.length - 1; index++) if (file.php.charCodeAt(index) === 10) lines++;
  }
  $('reverse-php-line-count').textContent = hasPhp ? `${lines.toLocaleString('zh-CN')} 行 · UTF-8` : 'UTF-8';
  $('reverse-selected-details').hidden = !file;
  if (file) {
    const details = [['tables', '表'], ['columns', '列'], ['sequences', '序列'], ['indexes', '索引'], ['seedRows', '条初始数据']]
      .map(([key, label]) => Number.isInteger(file.summary?.[key]) ? `${file.summary[key].toLocaleString('zh-CN')} ${label}` : `${label}待核验`);
    $('reverse-selected-details').replaceChildren(element('span', '', details.join(' · ')), element('span', '', verificationText(file)));
  } else $('reverse-selected-details').replaceChildren();
  $('reverse-php-preview').scrollTop = 0;
  $('reverse-php-preview').scrollLeft = 0;
}

async function copyText(text, label) {
  if (!text) return;
  try {
    if (typeof window.studio?.writeClipboard === 'function') await window.studio.writeClipboard(text);
    else await navigator.clipboard.writeText(text);
    toast(`${label}已复制`);
  } catch (error) {
    showNotice(`无法复制${label}：${messageOf(error)}。可以直接选中源码手动复制。`, 'error');
  }
}

function renderTemplateList(templates) {
  $('template-count').textContent = templates.length;
  $('template-list-empty').hidden = templates.length > 0;
  $('template-list-empty').textContent = '没有可用模板。';
  $('template-list').replaceChildren(...templates.map((template) => {
    const item = element('li');
    const button = element('button', 'template-item');
    button.type = 'button';
    button.dataset.templateId = template.id;
    button.setAttribute('aria-pressed', 'false');
    button.append(element('strong', '', template.name), element('span', '', template.description));
    button.addEventListener('click', () => loadTemplate(template.id));
    item.append(button);
    return item;
  }));
}

async function loadTemplate(id) {
  const request = ++state.templateRequest;
  $('template-preview').setAttribute('aria-busy', 'true');
  $('template-content').textContent = '正在读取模板…';
  $('save-template').disabled = true;
  $('copy-template').disabled = true;
  $('template-sql-tab').disabled = true;
  try {
    const template = await window.studio.getTemplate(id);
    if (request !== state.templateRequest) return;
    if (!template || typeof template.content !== 'string') throw new Error('模板内容不可用。');
    state.template = template;
    state.templateFormat = 'php';
    $('template-name').textContent = template.name;
    $('template-description').textContent = template.description || '可复制源码或另存为 PHP migration。';
    $('save-template').disabled = state.savingTemplate;
    $('copy-template').disabled = false;
    $('template-sql-tab').disabled = !template.sql;
    for (const button of $('template-list').querySelectorAll('button')) {
      const selected = button.dataset.templateId === template.id;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    renderTemplateContent();
  } catch (error) {
    if (request !== state.templateRequest) return;
    state.template = null;
    $('template-content').textContent = '模板未能加载，请重新选择模板。';
    showNotice(`读取模板失败：${messageOf(error)}`, 'error');
  } finally {
    if (request === state.templateRequest) $('template-preview').setAttribute('aria-busy', 'false');
  }
}

function renderTemplateContent() {
  if (!state.template) return;
  const sql = state.templateFormat === 'sql';
  $('template-content').textContent = sql ? state.template.sql : state.template.content;
  $('template-format-label').textContent = sql
    ? `SQL · PostgreSQL ${state.template.targetVersion || 16} 示例`
    : 'PHP · 静态解析';
  $('copy-template').lastChild.textContent = sql ? '复制 SQL' : '复制源码';
  for (const button of document.querySelectorAll('[data-template-format]')) {
    const selected = button.dataset.templateFormat === state.templateFormat;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  $('template-preview').setAttribute('aria-labelledby', sql ? 'template-sql-tab' : 'template-php-tab');
  $('template-preview').scrollTop = 0;
  $('template-preview').scrollLeft = 0;
}

async function saveTemplate() {
  if (!state.template || state.savingTemplate || $('save-template').disabled) return;
  state.savingTemplate = true;
  $('save-template').disabled = true;
  try {
    const result = await window.studio.saveTemplate({ id: state.template.id });
    if (result?.path) showNotice(`模板已保存：${result.path}`, 'success');
  } catch (error) {
    showNotice(`保存模板失败：${messageOf(error)}`, 'error');
  } finally {
    state.savingTemplate = false;
    $('save-template').disabled = !state.template;
  }
}

async function chooseIdeSdkProject() {
  if (state.busy) return;
  setBusy(true);
  try {
    const directory = await window.studio.chooseDirectory('ide-sdk');
    if (directory) {
      $('ide-sdk-project-dir').value = directory;
      $('ide-sdk-project-dir').title = directory;
    }
  } catch (error) {
    showNotice(messageOf(error), 'error');
  } finally { setBusy(false); }
}

async function exportIdeSdk() {
  if (state.busy) return;
  const outputDir = $('ide-sdk-project-dir').value.trim();
  if (!outputDir) {
    $('ide-sdk-project-dir').focus();
    showNotice('请选择或填写项目目录，以便导出 IDE 提示包。', 'error');
    return;
  }
  setBusy(true);
  $('ide-sdk-panel').setAttribute('aria-busy', 'true');
  $('export-ide-sdk').lastElementChild.textContent = '正在导出…';
  showNotice('');
  try {
    const inputDir = $('input-dir').value.trim();
    const result = await window.studio.exportIdeSdk({ outputDir, ...(inputDir ? { inputDir } : {}) });
    if (!result?.ok || typeof result.path !== 'string') throw new Error(result?.message || '提示包未能导出。');
    state.ideSdkPath = result.path;
    $('ide-sdk-output-path').textContent = result.path;
    $('ide-sdk-result-label').textContent = `提示包已导出 · SqlStudio ${result.version || state.info.ideSdk.version}`;
    $('ide-sdk-result').hidden = false;
    showNotice('IDE 提示包已导出。请在 IDE 中将提示包与迁移文件纳入同一项目索引。', 'success');
  } catch (error) {
    showNotice(`导出 IDE 提示包失败：${messageOf(error)}`, 'error');
  } finally {
    $('export-ide-sdk').lastElementChild.textContent = '导出提示包';
    $('ide-sdk-panel').setAttribute('aria-busy', 'false');
    setBusy(false);
  }
}

function renderIntegration(info) {
  const config = typeof info.mcpConfig === 'string' ? info.mcpConfig : JSON.stringify(info.mcpConfig, null, 2);
  $('mcp-config').textContent = config || '宿主未提供 MCP 配置。';
  $('copy-mcp').disabled = !config;
  const tools = Array.isArray(info.tools) ? info.tools : [
    { name: '预览与文件检查', description: '读取迁移并生成预览，报告文件与行号诊断。' },
    { name: 'PHP 与 SQL 双向转换', description: '按 PostgreSQL 版本转换，写入前执行完整预检。' },
    { name: '迁移模板与编写提示', description: '读取受支持的模板和迁移编写规范。' },
  ];
  $('mcp-tools-empty').hidden = tools.length > 0;
  $('mcp-tools').replaceChildren(...tools.map((tool) => {
    const item = element('li');
    item.append(element('strong', '', tool.name), element('span', '', tool.description));
    return item;
  }));
  const skillsPath = info.skillsPath || '';
  $('skills-path').textContent = skillsPath || '宿主未提供技能目录。';
  $('copy-skills').disabled = !skillsPath;
  const agentPath = info.agentPath || info.agentsPath || '';
  $('agents-row').hidden = !agentPath;
  $('agents-path').textContent = agentPath;
  $('agents-row').querySelector('.resource-label').textContent = info.agentPath ? '智能体提示词文件' : '智能体提示词目录';
}

function bindEvents() {
  for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => setPage(button.dataset.page));
  $('choose-input').addEventListener('click', () => chooseDirectory('input', 'input-dir'));
  $('choose-output').addEventListener('click', () => chooseDirectory('output', 'output-dir'));
  $('conversion-form').addEventListener('submit', (event) => { event.preventDefault(); runConversion('preview'); });
  $('convert-button').addEventListener('click', () => runConversion('convert'));
  for (const input of $('conversion-form').querySelectorAll('input, textarea, select')) input.addEventListener('input', invalidatePreview);
  $('guard').addEventListener('change', updateGuard);
  $('config-json').addEventListener('input', () => {
    $('config-error').hidden = true;
    $('config-json').removeAttribute('aria-invalid');
  });
  $('file-filter').addEventListener('input', renderFiles);
  $('copy-sql').addEventListener('click', () => copyText(state.selectedFile?.sql, 'SQL'));
  $('wrap-sql').addEventListener('click', () => {
    const wrap = $('sql-preview').classList.toggle('wrap');
    $('wrap-sql').setAttribute('aria-pressed', String(wrap));
  });
  $('open-output').addEventListener('click', async () => {
    if (!state.outputPath || state.busy) return;
    $('open-output').disabled = true;
    try { await window.studio.openOutput(state.outputPath); }
    catch (error) { showNotice(`无法打开输出目录：${messageOf(error)}`, 'error'); }
    finally { $('open-output').disabled = !state.outputPath || state.busy; }
  });
  $('choose-sql-files').addEventListener('click', chooseSqlFiles);
  $('choose-reverse-output').addEventListener('click', () => chooseDirectory('reverse-output', 'reverse-output-dir'));
  $('reverse-form').addEventListener('submit', (event) => { event.preventDefault(); runReverseConversion('preview'); });
  $('reverse-convert-button').addEventListener('click', () => runReverseConversion('convert'));
  for (const input of $('reverse-form').querySelectorAll('input, textarea, select')) input.addEventListener('input', invalidateReversePreview);
  $('reverse-source-files').addEventListener('input', updateReverseInputCount);
  $('reverse-guard').addEventListener('change', updateReverseGuard);
  $('reverse-file-filter').addEventListener('input', renderReverseFiles);
  $('reverse-copy-php').addEventListener('click', () => copyText(reverseState.selectedFile?.php, 'PHP 源码'));
  $('reverse-wrap-php').addEventListener('click', () => {
    const wrap = $('reverse-php-preview').classList.toggle('wrap');
    $('reverse-wrap-php').setAttribute('aria-pressed', String(wrap));
  });
  $('reverse-open-output').addEventListener('click', async () => {
    if (!reverseState.outputPath || state.busy) return;
    $('reverse-open-output').disabled = true;
    try { await window.studio.openOutput(reverseState.outputPath); }
    catch (error) { showNotice(`无法打开 PHP 输出目录：${messageOf(error)}`, 'error'); }
    finally { $('reverse-open-output').disabled = !reverseState.outputPath || state.busy; }
  });
  $('save-template').addEventListener('click', saveTemplate);
  $('choose-ide-sdk-project').addEventListener('click', chooseIdeSdkProject);
  $('export-ide-sdk').addEventListener('click', exportIdeSdk);
  $('open-ide-sdk').addEventListener('click', async () => {
    if (!state.ideSdkPath || state.busy) return;
    $('open-ide-sdk').disabled = true;
    try { await window.studio.openOutput(state.ideSdkPath); }
    catch (error) { showNotice(`无法打开提示包目录：${messageOf(error)}`, 'error'); }
    finally { $('open-ide-sdk').disabled = !state.ideSdkPath || state.busy; }
  });
  $('copy-template').addEventListener('click', () => {
    const text = state.templateFormat === 'sql' ? state.template?.sql : state.template?.content;
    copyText(text, state.templateFormat === 'sql' ? 'SQL 示例' : 'PHP 模板');
  });
  for (const button of document.querySelectorAll('[data-template-format]')) {
    button.addEventListener('click', () => {
      state.templateFormat = button.dataset.templateFormat;
      renderTemplateContent();
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? $('template-php-tab')
        : event.key === 'End' ? $('template-sql-tab')
          : button.id === 'template-php-tab' ? $('template-sql-tab') : $('template-php-tab');
      if (!target.disabled) { target.click(); target.focus(); }
    });
  }
  $('copy-mcp').addEventListener('click', () => copyText($('mcp-config').textContent, 'MCP 连接配置'));
  $('copy-skills').addEventListener('click', () => copyText(state.info?.skillsPath, '技能目录路径'));
  $('copy-agents').addEventListener('click', () => copyText(state.info?.agentPath || state.info?.agentsPath, '智能体提示词路径'));
}

async function initialize() {
  bindEvents();
  if (!window.studio) {
    setBusy(true, '本地转换服务未连接');
    operationStatus('本地转换服务未连接', false, 'reverse');
    showNotice('未连接本地宿主。请通过桌面软件或项目提供的本地预览服务打开此页面。', 'error');
    $('template-list-empty').textContent = '本地宿主未连接，无法读取模板。';
    $('mcp-config').textContent = '本地宿主未连接。';
    $('skills-path').textContent = '本地宿主未连接。';
    return;
  }
  setBusy(true, '正在加载本地配置…');
  try {
    const info = await window.studio.getInfo();
    state.info = info;
    $('app-version').textContent = info.version || '—';
    $('ide-sdk-version').textContent = info.ideSdk ? `${info.ideSdk.namespace} ${info.ideSdk.version}` : '提示包不可用';
    const defaults = info.defaults || {};
    $('input-dir').value = defaults.inputDir || '';
    $('output-dir').value = defaults.outputDir || '';
    $('target-version').value = String(defaults.targetVersion || 16);
    if (typeof defaults.guard === 'boolean') $('guard').checked = defaults.guard;
    if (defaults.config) $('config-json').value = JSON.stringify(defaults.config, null, 2);
    updateGuard();
    renderTemplateList(Array.isArray(info.templates) ? info.templates : []);
    renderIntegration(info);
    setBusy(false, '先预览结果，再生成 SQL 文件');
  } catch (error) {
    setBusy(false, '本地配置加载失败');
    showNotice(`无法读取本地配置：${messageOf(error)}`, 'error');
    $('template-list-empty').textContent = '模板列表未能加载，请重新启动应用。';
    $('mcp-config').textContent = '配置未能加载。';
    $('skills-path').textContent = '路径未能加载。';
  }
}

initialize();
