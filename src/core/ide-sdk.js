import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceStorage } from './workspace.js';

export const IDE_SDK = Object.freeze({ namespace: 'SqlStudio', version: '0.5.0', path: fileURLToPath(new URL('../../php-sdk/', import.meta.url)) });
const { assertSafePath, identity } = workspaceStorage;

/** 将随客户端交付的声明包复制到项目目录；不覆盖用户修改的 SDK。 */
export async function exportIdeSdk({ outputDir, inputDir } = {}) {
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw new Error('请选择已存在的项目绝对目录。');
  const parent = path.resolve(outputDir);
  await assertSafePath(parent);
  if (!(await fs.stat(parent)).isDirectory()) throw new Error('SDK 的父路径必须是项目目录。');
  const destination = path.join(parent, 'sql-studio-sdk');
  if (inputDir) {
    if (typeof inputDir !== 'string' || !path.isAbsolute(inputDir)) throw new Error('迁移输入路径必须为绝对目录。');
    await assertSafePath(inputDir);
    const relative = path.relative(identity(inputDir), identity(destination));
    if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
      throw new Error('IDE 提示包必须放在迁移输入目录之外，请选择项目目录或 migration 的父目录。');
    }
  }
  // 即使尚未选择正向输入，也不要把声明包写入已登记的反向输出目录。
  for (let directory = parent; ; directory = path.dirname(directory)) {
    try {
      await fs.lstat(path.join(directory, '.migration-php-manifest.json'));
      throw new Error('IDE 提示包不能放入已生成 PHP 的 migration 目录，请选择其父目录。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (directory === path.dirname(directory)) break;
  }
  const files = [];
  async function collect(relative = '') {
    for (const item of await fs.readdir(path.join(IDE_SDK.path, relative), { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      if (item.isDirectory()) await collect(name);
      else if (item.isFile()) files.push({ name, bytes: await fs.readFile(path.join(IDE_SDK.path, name)) });
      else throw new Error('内置 SDK 包含异常文件。');
    }
  }
  await collect();
  await assertSafePath(destination);
  let existing;
  try { existing = await fs.lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isDirectory()) throw new Error('sql-studio-sdk 已存在且不是目录。');
    for (const file of files) {
      const target = path.join(destination, file.name);
      await assertSafePath(target);
      let bytes;
      try { bytes = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!bytes?.equals(file.bytes)) throw new Error('已有 sql-studio-sdk 与当前版本不同，已保留原文件；请选择其他项目目录或先手动备份并移走旧包。');
    }
    return { ok: true, path: destination, files: files.map(file => file.name), version: IDE_SDK.version, skipped: true };
  }
  const staging = await fs.mkdtemp(path.join(parent, '.sql-studio-sdk-'));
  // 仅发布完整目录；写入失败保留临时包以便诊断，不触碰已有文件。
  try {
    for (const file of files) {
      const target = path.join(staging, file.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.bytes, { flag: 'wx' });
    }
    await assertSafePath(parent);
    await fs.rename(staging, destination);
  } catch (error) { throw new Error(`SDK 导出失败，临时文件保留在 ${staging}：${error.message}`); }
  return { ok: true, path: destination, files: files.map(file => file.name), version: IDE_SDK.version, skipped: false };
}
