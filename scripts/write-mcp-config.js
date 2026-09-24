import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 根据明确指定且完整的便携包目录生成配置；保留已有不同内容。 */
export async function writeMcpConfig(packageDirectory) {
  if (typeof packageDirectory !== 'string' || !path.isAbsolute(packageDirectory)) {
    throw new Error('请通过 --package-dir 指定便携包的绝对目录。');
  }
  const directory = path.normalize(packageDirectory);
  const executable = path.join(directory, 'Migration SQL Studio.exe');
  const appDirectory = path.join(directory, 'resources', 'app');
  const mcpScript = path.join(appDirectory, 'src', 'mcp.js');
  const packageFile = path.join(appDirectory, 'package.json');
  for (const file of [executable, mcpScript, packageFile]) {
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`不是完整的 Migration SQL Studio 便携包，缺少普通文件：${file}`);
  }
  const metadata = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  if (metadata.name !== 'migration-sql-studio') throw new Error('目标目录的应用名称不匹配，未生成 MCP 配置。');
  const configuration = { mcpServers: { 'migration-sql': {
    command: executable,
    args: [mcpScript],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  } } };
  const target = path.join(directory, 'MCP配置.json');
  const content = `${JSON.stringify(configuration, null, 2)}\n`;
  try {
    await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
    return { path: target, created: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fs.lstat(target);
    if (stat.isFile() && !stat.isSymbolicLink() && await fs.readFile(target, 'utf8') === content) {
      return { path: target, created: false };
    }
    throw new Error('MCP配置.json 已存在且内容不同，未覆盖。请从客户端“AI 接入”复制当前配置，或先将旧配置改名保存后重新生成。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--package-dir') throw new Error('用法：write-mcp-config.js --package-dir <便携包绝对目录>');
    console.log(JSON.stringify(await writeMcpConfig(args[1]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
