import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as converter from './core/converter.js';
import * as reverse from './core/reverse.js';
import { IDE_SDK } from './core/ide-sdk.js';
export { exportIdeSdk } from './core/ide-sdk.js';
export { previewDirectory, convertDirectory } from './core/workspace.js';
export { previewReverse, convertReverse } from './core/reverse-workspace.js';

export const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = '0.5.0';
export const TEMPLATES = [
  { id: 'generic', name: '通用业务表', description: '字段、默认值、注释与索引；从一张新表开始。', table: 'demo_item' },
  { id: 'yudao', name: '芋道审计与租户', description: 'creator / create_time / updater / update_time / deleted / tenant_id。', table: 'demo_audit' },
  { id: 'rules', name: '动态配置表名', description: '对应原始 rules 迁移；通过 JSON 显式提供配置。' },
  { id: 'seeded', name: '初始化数据与重建开关', description: '用 data() 填充初始数据；exists_drop 默认关闭。', table: 'demo_seed' },
];
export const TOOLS = [
  { name: 'migration_export_ide_sdk', description: '在项目目录下导出 SqlStudio PHP IDE 提示包，保留已有不同内容；必须放在迁移输入目录之外' },
  { name: 'migration_capabilities', description: '读取当前转换器支持的方法与限制' },
  { name: 'migration_template', description: '获取 PHP 模板与 SQL 示例，不写文件' },
  { name: 'migration_validate', description: '静态校验一段 PHP 并返回 SQL，不执行 PHP' },
  { name: 'migration_preview', description: '预检整个迁移目录并返回 SQL，不写文件' },
  { name: 'migration_convert', description: '预检后生成 SQL 和哈希清单；默认开启文件保护' },
  { name: 'migration_write_template', description: '把内置模板保存为新 PHP 文件；已有文件会拒绝' },
  { name: 'migration_reverse_validate', description: '将 PostgreSQL SQL 转为 PHP 并校验往返语义，不写文件' },
  { name: 'migration_reverse_preview', description: '预览选中的 SQL 文件转为同名 PHP，检查双向转换与文件变更' },
  { name: 'migration_reverse_convert', description: '校验后生成同名 PHP 文件，默认保护已有文件并保留覆盖备份' },
];

export function capabilities() {
  return {
    version: VERSION,
    compilerVersion: converter.COMPILER_VERSION,
    ideSdk: { namespace: IDE_SDK.namespace, version: IDE_SDK.version, executesPhp: false },
    ...converter.CAPABILITIES,
    reverse: { version: reverse.REVERSE_VERSION, ...reverse.REVERSE_CAPABILITIES },
    executesPhp: false,
    executesSql: false,
    guard: '比较上次成功转换的 PHP 与 SQL 哈希；任一修改或删除阻断，新文件可追加。',
    supportedTemplateExtensions: ['data()', 'exists_drop'],
    unsupportedTemplateExtensions: [],
    validation: '静态转换不是目标数据库实际导入验收。',
  };
}

export function validatePhp({ source, sourceName = 'migration.php', targetVersion, config = {} }) {
  try {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 32 * 1024 * 1024) {
      throw new Error('PHP 内容必须是字符串，且不超过 32 MiB。');
    }
    return { ok: true, ...converter.convertPhp(source, { sourceName, targetVersion, config }) };
  } catch (error) {
    return { ok: false, diagnostics: [{ code: error.code ?? 'INVALID_PHP', file: sourceName, line: error.line, message: error.message }] };
  }
}

/** 只读转换 SQL 文本，并返回可追踪的解析或往返校验诊断。 */
export async function validateSql({ source, sourceName = 'schema.sql', targetVersion }) {
  try {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 32 * 1024 * 1024) throw new Error('SQL 内容必须是字符串，且不超过 32 MiB。');
    return { ok: true, ...await reverse.reverseSql(source, { sourceName, targetVersion }) };
  } catch (error) {
    return { ok: false, diagnostics: [{ code: error.code ?? 'INVALID_SQL', file: sourceName, line: error.line, message: error.message }] };
  }
}

export async function getTemplate(id, { tableName, targetVersion = 16 } = {}) {
  const item = TEMPLATES.find((template) => template.id === id);
  if (!item) throw new Error(`未知模板，请使用 ${TEMPLATES.map((template) => template.id).join('、')}。`);
  let content = await fs.readFile(path.join(APP_ROOT, 'templates', `${id}.php`), 'utf8');
  if (tableName !== undefined) {
    if (!item.table) throw new Error('rules 模板使用配置表名，请通过 permission.database.table 指定。');
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(tableName)) throw new Error('表名须为小写字母开头的字母、数字和下划线，最多 40 字符。');
    content = content.replace(`Schema::create('${item.table}'`, `Schema::create('${tableName}'`)
      .replace(`Schema::dropIfExists('${item.table}'`, `Schema::dropIfExists('${tableName}'`);
  }
  const config = id === 'rules' ? { 'permission.database.table': 'rules' } : {};
  const result = validatePhp({ source: content, sourceName: `${id}.php`, targetVersion, config });
  if (!result.ok) throw new Error(`内置模板校验失败：${result.diagnostics.map((d) => d.message).join('；')}`);
  return { ...item, content, sql: result.sql, warnings: result.warnings, summary: result.summary, targetVersion, config };
}

// 模板写入只创建新文件，并拒绝路径中的链接，避免误写另一个工程。
export async function writeTemplate({ id, outputPath, tableName, targetVersion = 16 }) {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || !/\.php$/i.test(outputPath)) {
    throw new Error('模板输出必须是绝对路径且以 .php 结尾。');
  }
  const destination = path.normalize(outputPath);
  if (process.platform === 'win32' && /[<>:"|?*]/.test(destination.slice(path.parse(destination).root.length))) {
    throw new Error('模板输出包含无效的 Windows 文件名字符。');
  }
  if (destination.slice(path.parse(destination).root.length).split(path.sep).some((part) =>
    /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('模板路径不能使用 Windows 保留设备名或以空格、句点结尾。');
  }
  for (let dir = path.dirname(destination); ; dir = path.dirname(dir)) {
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('模板父目录必须是已存在的普通目录，不能使用符号链接。');
    if (dir === path.dirname(dir)) break;
  }
  const template = await getTemplate(id, { tableName, targetVersion });
  await fs.writeFile(destination, template.content, { encoding: 'utf8', flag: 'wx' });
  return { ok: true, path: destination };
}

export function getInfo({ executable = process.execPath, packaged = false } = {}) {
  return {
    version: VERSION,
    appPath: APP_ROOT,
    ideSdk: IDE_SDK,
    templates: TEMPLATES,
    tools: TOOLS,
    skillsPath: path.join(APP_ROOT, 'skills', 'migration-sql'),
    agentPath: path.join(APP_ROOT, 'agents', 'migration-author.md'),
    mcpConfig: {
      mcpServers: {
        'migration-sql': {
          command: executable,
          args: [path.join(APP_ROOT, 'src', 'mcp.js')],
          ...(packaged ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}),
        },
      },
    },
    defaults: { inputDir: '', outputDir: '', targetVersion: 16, guard: true, config: {} },
  };
}
