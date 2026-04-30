/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.31.1', 'localhost', '127.0.0.1', '192.168.0.6', '192.168.0.3'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/api/:path*'
      }
    ];
  },
  async headers() {
    return [
      {
        // Disable buffering on the SSE chat endpoint so events stream in real time
        source: '/api/assistant/chat/llm',
        headers: [
          { key: 'X-Accel-Buffering', value: 'no' },
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
        ],
      },
    ];
  },
};

export default nextConfig;
