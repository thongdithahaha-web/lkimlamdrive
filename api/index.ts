import app from '../server';

export default function handler(req: any, res: any) {
  try {
    const originalUrl =
      (req.headers['x-forwarded-url'] as string) ||
      (req.headers['x-matched-path'] as string) ||
      req.url;

    if (
      originalUrl &&
      (req.url === '/api/index' || req.url === '/api' || req.url.startsWith('/api/index?'))
    ) {
      req.url = originalUrl;
    }

    return app(req, res);
  } catch (err: any) {
    console.error('Vercel API handler error:', err);
    res.status(500).json({ error: 'Server error: ' + (err?.message || String(err)) });
  }
}

