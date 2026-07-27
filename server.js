const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const API_HOST = 'api.abasss.org';

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.pdf': 'application/pdf'
};

const PROXY_PREFIXES = ['/api/', '/v1/', '/static/'];

function proxyRequest(req, res) {
    const targetUrl = `https://${API_HOST}${req.url}`;

    const headers = { ...req.headers };
    headers['host'] = API_HOST;
    headers['x-forwarded-for'] = req.socket.remoteAddress;
    headers['x-forwarded-host'] = `localhost:${PORT}`;
    headers['x-forwarded-proto'] = 'http';

    delete headers['origin'];
    delete headers['referer'];

    const proxyReq = https.request(targetUrl, {
        method: req.method,
        headers
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        console.error(`[PROXY] ${req.method} ${req.url} -> ERROR: ${err.message}`);
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ success: false, message: 'Proxy error: API unreachable' }));
    });

    req.pipe(proxyReq, { end: true });
}

function serveStatic(req, res) {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
        });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    const isProxy = PROXY_PREFIXES.some(p => req.url.startsWith(p));

    if (isProxy) {
        proxyRequest(req, res);
    } else {
        serveStatic(req, res);
    }
});

server.listen(PORT, () => {
    console.log(`\n  result.abasss.org dev server`);
    console.log(`  http://localhost:${PORT}\n`);
    console.log(`  Proxying ${PROXY_PREFIXES.join(', ')} -> https://${API_HOST}\n`);
});
