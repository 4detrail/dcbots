const http = require('http');

/**
 * UptimeRobot (veya benzeri bir servis) bu sunucuya her birkaç dakikada
 * bir istek atarak Replit/Render gibi platformlarda projenin "uykuya
 * dalmasini" engeller. Discord botunun kendisiyle ilgisi yoktur,
 * sadece platformu "meşgul/canli" gostermek icindir.
 */
function startKeepAliveServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Hexages Games Guvenlik Sistemi calisiyor. Bot aktif.');
  });

  server.listen(port, () => {
    console.log(`[KeepAlive] HTTP sunucu ${port} portunda ayakta. UptimeRobot bu adrese ping atmali.`);
  });

  return server;
}

module.exports = { startKeepAliveServer };
