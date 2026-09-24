import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { APP_ROOT, getInfo, getTemplate, previewDirectory, convertDirectory, previewReverse, convertReverse, exportIdeSdk } from '../src/api.js';

const token = randomBytes(24).toString('hex');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const bridge = `(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  async function call(action, data) {
    const response = await fetch('/api/' + action, {method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(data ?? {})});
    const result = await response.json(); if (!response.ok) throw new Error(result.message); return result;
  }
  window.studio = {
    getInfo: () => call('info'), preview: (o) => call('preview', o), convert: (o) => call('convert', o),
    previewReverse: (o) => call('previewReverse', o), convertReverse: (o) => call('convertReverse', o),
    chooseSqlFiles: async () => { throw new Error('Chrome 验证模式请填写 SQL 文件的绝对路径，每行一个；桌面软件支持原生多选。'); },
    getTemplate: (id) => call('template', {id}),
    exportIdeSdk: (o) => call('exportIdeSdk', o),
    chooseDirectory: async () => { throw new Error('Chrome 验证模式请直接填写目录；桌面软件支持原生文件夹选择。'); },
    saveTemplate: async () => { throw new Error('请在桌面软件使用原生保存对话框，或使用 CLI template 命令。'); },
    openOutput: async () => { throw new Error('请在桌面软件打开资源管理器。'); },
  };
})();`;
let busy = false;
const server = http.createServer(async (request, response) => {
  const send = (status, body, contentType = 'application/json; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (request.headers.host !== new URL(origin).host) return send(403, { message: 'Invalid host' });
  try {
    if (request.method === 'POST' && request.url.startsWith('/api/')) {
      if (request.headers['x-studio-token'] !== token || (request.headers.origin && request.headers.origin !== origin)) return send(403, { message: '本地会话校验失败。' });
      let data = '';
      for await (const chunk of request) { data += chunk; if (Buffer.byteLength(data) > 2 * 1024 * 1024) return send(413, { message: '请求过大。' }); }
      const body = JSON.parse(data || '{}');
      const action = request.url.slice('/api/'.length);
      if (action === 'info') return send(200, getInfo());
      if (action === 'template') return send(200, await getTemplate(body.id));
      if (['preview', 'convert', 'previewReverse', 'convertReverse', 'exportIdeSdk'].includes(action)) {
        if (busy) return send(409, { message: '批次正在运行。' });
        busy = true;
        try { return send(200, await ({ preview: previewDirectory, convert: convertDirectory, previewReverse, convertReverse, exportIdeSdk })[action](body)); }
        finally { busy = false; }
      }
      return send(404, { message: '未知操作。' });
    }
    if (request.method !== 'GET') return send(405, { message: 'Method not allowed' });
    if (request.url === '/bridge.js') return send(200, bridge, mime['.js']);
    const filename = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' }[request.url];
    if (!filename) return send(404, { message: 'Not found' });
    let content = await fs.readFile(path.join(APP_ROOT, 'src/renderer', filename), 'utf8');
    if (filename === 'index.html') content = content.replace('</head>', '<script src="/bridge.js"></script></head>');
    return send(200, content, mime[path.extname(filename)]);
  } catch (error) { return send(400, { message: error.message }); }
});
server.listen(Number(process.env.STUDIO_PREVIEW_PORT || 0), '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${server.address().port}/#token=${token}`);
});
