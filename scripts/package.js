import { packager } from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';

// 禁止静默覆盖已交付包；每次打包使用独立目录。
const destination = path.resolve('dist', new Date().toISOString().replace(/[:.]/g, '-'));
const outputs = await packager({
  dir: process.cwd(), name: 'Migration SQL Studio', executableName: 'Migration SQL Studio',
  platform: 'win32', arch: 'x64', out: destination, overwrite: false,
  asar: false, prune: true,
  ignore: [/^\/dist(?:\/|$)/, /^\/artifacts(?:\/|$)/, /^\/\.test-output(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/启动最新版\.cmd$/, /^\/scripts\/apply-sqlstudio-imports\.js$/, /(?:^|\/)__pycache__(?:\/|$)/, /\.py[co]$/],
  win32metadata: { CompanyName: 'Local Tools', FileDescription: 'PHP migration to PostgreSQL SQL', ProductName: 'Migration SQL Studio' },
});
for (const output of outputs) {
  await fs.writeFile(path.join(output, 'migration-sql.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0Migration SQL Studio.exe" "%~dp0resources\\app\\src\\cli.js" %*\r\n', 'utf8');
  await fs.writeFile(path.join(output, '生成MCP配置.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0Migration SQL Studio.exe" "%~dp0resources\\app\\scripts\\write-mcp-config.js" --package-dir "%~dp0."\r\nset "STUDIO_EXIT_CODE=%ERRORLEVEL%"\r\nif not "%STUDIO_EXIT_CODE%"=="0" pause\r\nexit /b %STUDIO_EXIT_CODE%\r\n', 'utf8');
  const executable = path.relative(process.cwd(), path.join(output, 'Migration SQL Studio.exe'));
  await fs.writeFile(path.resolve('启动最新版.cmd'), `@echo off\r\nstart "" "%~dp0${executable}"\r\n`, 'utf8');
  console.log(output);
}
