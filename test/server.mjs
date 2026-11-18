import http from 'node:http';
import {readFile, mkdir, appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function startServer(port = 0) {
  await mkdir(path.join(root, 'test/results'), {recursive: true});
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/log') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 16384) { res.writeHead(413).end(); return; }
        }
        const event = JSON.parse(body);
        // Test-only sink: accept detector output, never browser properties or identifiers.
        const clean = {event: event.event, traffic_class: event.traffic_class,
          traffic_phase: event.traffic_phase, traffic_score: event.traffic_score,
          traffic_signals: event.traffic_signals};
        await appendFile(path.join(root, 'test/results/log.jsonl'), JSON.stringify(clean) + '\n');
        res.writeHead(204).end(); return;
      }
      const files = {'/': 'test/site/index.html', '/index.html': 'test/site/index.html',
        '/page2.html': 'test/site/page2.html', '/page3.html': 'test/site/page3.html',
        '/site.js': 'test/site/site.js', '/src/traffic-class.js': 'src/traffic-class.js'};
      const file = files[url.pathname];
      if (req.method !== 'GET' || !file) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, {'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(await readFile(path.join(root, file)));
    } catch { res.writeHead(400).end('Bad request'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {server, origin: `http://127.0.0.1:${server.address().port}`};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {origin} = await startServer(Number(process.env.PORT || 8787));
  console.log(`Test site: ${origin}`);
}
