const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'https://localhost:8998',
      changeOrigin: true,
      secure: false,
    })
  );
  app.use(
    '/cmd',
    createProxyMiddleware({
      target: 'https://localhost:8998',
      changeOrigin: true,
      secure: false,
    })
  );
};
