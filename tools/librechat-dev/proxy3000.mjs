// Exposes the LibreChat backend (127.0.0.1:3080) on this chat's reserved preview port 3000.
import http from 'node:http';
const target = { host: '127.0.0.1', port: 3080 };
http
  .createServer((req, res) => {
    const options = { ...target, path: req.url, method: req.method, headers: { ...req.headers, host: `${target.host}:${target.port}` } };
    const upstream = http.request(options, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${error.message}`);
    });
    req.pipe(upstream);
  })
  .listen(3000, '0.0.0.0', () => console.log('proxy 3000 -> 3080 ready'));
