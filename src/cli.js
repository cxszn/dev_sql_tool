import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspaceStorage } from './core/workspace.js';
import { capabilities, getTemplate, writeTemplate, previewDirectory, convertDirectory, validatePhp, previewReverse, convertReverse, validateSql, exportIdeSdk } from './api.js';

const HELP = `Migration SQL Studio

  node src/cli.js preview --input <目录> --output <目录> --pg-version 16|18 [--config <JSON文件>] [--no-guard] [--json]
  node src/cli.js convert --input <目录> --output <目录> --pg-version 16|18 [--config <JSON文件>] [--no-guard] [--json]
  node src/cli.js validate --file <PHP文件> --pg-version 16|18 [--config <JSON文件>] [--json]
  node src/cli.js template --id generic|yudao|rules|seeded [--table <表名>] [--out <新PHP文件>] [--json]
  node src/cli.js capabilities
  node src/cli.js ide-sdk --output <项目目录> [--input <迁移目录>] [--json]
  node src/cli.js reverse-validate --file <SQL文件> --pg-version 16|18 [--json]
  node src/cli.js reverse-preview --files <JSON路径清单> --output <目录> --pg-version 16|18 [--no-guard] [--json]
  node src/cli.js reverse-convert --files <JSON路径清单> --output <目录> --pg-version 16|18 [--no-guard] [--json]

默认预检测 PHP 与 SQL 是否被修改；关闭预检测会在覆盖前保留备份。
所有操作只生成文件，不执行 PHP，不连接数据库。
退出码：0 成功；1 转换/预检失败；2 参数或文件错误。
`;

export async function runCli(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv[0] === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const [command, ...args] = argv;
  const commandFlags = {
    capabilities: [],
    'ide-sdk': ['--output', '--input', '--json'],
    template: ['--id', '--table', '--out', '--json'],
    validate: ['--file', '--pg-version', '--config', '--json'],
    preview: ['--input', '--output', '--pg-version', '--config', '--no-guard', '--json'],
    convert: ['--input', '--output', '--pg-version', '--config', '--no-guard', '--json'],
    'reverse-validate': ['--file', '--pg-version', '--json'],
    'reverse-preview': ['--files', '--output', '--pg-version', '--no-guard', '--json'],
    'reverse-convert': ['--files', '--output', '--pg-version', '--no-guard', '--json'],
  };
  const options = {};
  try {
    if (!commandFlags[command]) throw new Error(`未知命令 ${command}，使用 --help 查看。`);
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (!commandFlags[command].includes(key) || key in options) throw new Error(`未知或重复参数 ${key}`);
      if (['--json', '--no-guard'].includes(key)) options[key] = true;
      else {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`参数 ${key} 缺少值。`);
        options[key] = value;
      }
    }
    let result;
    if (command === 'capabilities') result = capabilities();
    else if (command === 'ide-sdk') {
      if (!options['--output']) throw new Error('必须指定 --output 项目目录。');
      result = await exportIdeSdk({ outputDir: path.resolve(options['--output']), inputDir: options['--input'] ? path.resolve(options['--input']) : undefined });
    }
    else if (command === 'template') {
      const templateOptions = { tableName: options['--table'] };
      result = options['--out']
        ? await writeTemplate({ id: options['--id'] ?? 'generic', outputPath: path.resolve(options['--out']), ...templateOptions })
        : await getTemplate(options['--id'] ?? 'generic', templateOptions);
      if (!options['--out'] && !options['--json']) { process.stdout.write(result.content); return 0; }
    } else {
      const targetVersion = Number(options['--pg-version']);
      if (![16, 18].includes(targetVersion)) throw new Error('必须显式指定 --pg-version 16 或 18。');
      const config = options['--config'] ? JSON.parse(await fs.readFile(options['--config'], 'utf8')) : {};
      if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('配置 JSON 必须是对象。');
      if (command === 'reverse-validate') {
        if (!options['--file']) throw new Error('缺少 --file。');
        const file = path.resolve(options['--file']);
        const snapshot = await workspaceStorage.snapshot(file, 32 * 1024 * 1024);
        if (!snapshot.bytes) throw new Error('SQL 文件不存在。');
        let source;
        try { source = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes); }
        catch { throw new Error('SQL 文件不是有效的 UTF-8，请先明确转换文件编码。'); }
        result = await validateSql({ source, sourceName: file, targetVersion });
      } else if (command === 'reverse-preview' || command === 'reverse-convert') {
        if (!options['--files'] || !options['--output']) throw new Error('必须指定 --files JSON路径清单和 --output。');
        const sourceFiles = JSON.parse(await fs.readFile(options['--files'], 'utf8'));
        if (!Array.isArray(sourceFiles) || !sourceFiles.length || sourceFiles.some((file) => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('--files 清单必须是非空的 SQL 绝对路径 JSON 数组。');
        result = await (command === 'reverse-preview' ? previewReverse : convertReverse)({ sourceFiles, outputDir: path.resolve(options['--output']), targetVersion, guard: !options['--no-guard'] });
      } else if (command === 'validate') {
        if (!options['--file']) throw new Error('缺少 --file。');
        const file = path.resolve(options['--file']);
        result = validatePhp({ source: await fs.readFile(file, 'utf8'), sourceName: file, targetVersion, config });
      } else {
        if (!options['--input'] || !options['--output']) throw new Error('必须指定 --input 和 --output。');
        result = await (command === 'preview' ? previewDirectory : convertDirectory)({
          inputDir: path.resolve(options['--input']), outputDir: path.resolve(options['--output']),
          targetVersion, config, guard: !options['--no-guard'],
        });
      }
    }
    if (options['--json'] || command === 'capabilities') process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else if (result.ok === false) {
      for (const item of result.diagnostics) process.stderr.write(`${item.file ?? ''}${item.line ? ':' + item.line : ''} [${item.code}] ${item.message}\n`);
    } else if (command === 'ide-sdk') {
      process.stdout.write(`IDE 提示包${result.skipped ? '已存在且一致' : '已导出'}：${result.path}\n`);
    } else if (result.files) {
      process.stdout.write(`${command.endsWith('preview') ? '预检' : '转换'}成功：${result.files.length} 个文件，写入 ${result.written ?? 0}，跳过 ${result.skipped ?? 0}。\n`);
      for (const file of result.files) {
        process.stdout.write(`${file.sourceName} → ${file.outputName} [${file.status}]\n`);
        for (const warning of file.warnings ?? []) process.stdout.write(`  提示：${warning.message}\n`);
      }
      if (result.backupDir) process.stdout.write(`备份：${result.backupDir}\n`);
    } else process.stdout.write(result.sql ?? result.php ?? JSON.stringify(result, null, 2) + '\n');
    return result.ok === false ? 1 : 0;
  } catch (error) {
    const result = { ok: false, diagnostics: [{ code: 'CLI_ARGUMENT', message: error.message }] };
    (options['--json'] ? process.stdout : process.stderr).write(options['--json'] ? JSON.stringify(result) + '\n' : error.message + '\n');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runCli();
}
