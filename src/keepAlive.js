const http = require('http');

function startKeepAliveServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Hexages Games Guvenlik Sistemi calisiyor.');
  });
  server.listen(port, () => {
    console.log(`[KeepAlive] ${port} portunda calisiyor.`);
  });
  return server;
}

module.exports = { startKeepAliveServer };
