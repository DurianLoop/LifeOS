import handler from './memorial.mjs';

export default handler;

export const config = {
  path: '/v2/public/memorial/ask',
  rateLimit: { windowLimit: 6, windowSize: 3600, aggregateBy: ['ip', 'domain'] },
};
