import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { convertPhp } from '../src/core/converter.js';
import { getTemplate, TEMPLATES } from '../src/api.js';

const input = process.argv[2];
if (!input || !path.isAbsolute(input)) throw new Error('用法：node scripts/verify-reference.js <参考 migrations 绝对目录>');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve('artifacts', `reference-validation-${stamp}`);
const report = { input, output, executedPhp: false, databaseImport: 'not_run', results: [] };
await fs.mkdir(output, { recursive: true });
for (const targetVersion of [16, 18]) {
  const directory = path.join(output, `pg${targetVersion}`);
  await fs.mkdir(directory);
  for (const name of (await fs.readdir(input)).filter((name) => name.endsWith('.php')).sort()) {
    const source = await fs.readFile(path.join(input, name));
    const item = { targetVersion, name, sourceSha256: createHash('sha256').update(source).digest('hex') };
    try {
      const converted = convertPhp(source.toString('utf8'), { targetVersion, config: { 'permission.database.table': 'rules' }, sourceName: name });
      const sqlFile = path.join(directory, name.replace(/\.php$/, '.sql'));
      await fs.writeFile(sqlFile, converted.sql, { flag: 'wx' });
      Object.assign(item, { ok: true, sqlFile, warnings: converted.warnings, tables: converted.tables });
    } catch (error) { Object.assign(item, { ok: false, error: error.message, code: error.code }); }
    report.results.push(item);
  }
  for (const { id } of TEMPLATES) {
    const template = await getTemplate(id, { targetVersion });
    const sqlFile = path.join(directory, `template-${id}.sql`);
    await fs.writeFile(sqlFile, template.sql, { flag: 'wx' });
    report.results.push({ targetVersion, name: `template:${id}`, ok: true, sqlFile, warnings: template.warnings });
  }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, passed: report.results.filter((item) => item.ok).length, total: report.results.length }, null, 2));
if (report.results.some((item) => !item.ok)) process.exitCode = 1;
