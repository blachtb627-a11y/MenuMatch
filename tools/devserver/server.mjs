/**
 * Offline stand-in for the Supabase RPC surface.
 *
 * Speaks the same shapes public.get_config / get_feed / get_recipe return
 * (the fixtures were captured from the live database), so the client can be
 * developed and verified without network access to the project.
 *
 * Development only. Never point a build at this for anything but local work.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
const PORT = Number(process.env.PORT ?? 8787);

function rpc(name, body) {
  switch (name) {
    case 'get_config':
      return fx.config;
    case 'register_device':
      return '00000000-0000-4000-8000-000000000001';
    case 'get_feed': {
      // Stateless: the client sends what it has already seen, exactly as the
      // real get_feed treats p_exclude. Keeping no server-side memory means a
      // fresh browser session always gets a full deck.
      const exclude = new Set(body?.p_exclude ?? []);
      const cards = fx.feed.cards.filter((c) => !exclude.has(c.id));
      return { ...fx.feed, cards, fallback: cards.length ? 'personalized' : 'exhausted' };
    }
    case 'get_recipe':
      return fx.recipe.id === body?.p_recipe_id
        ? fx.recipe
        : { ...fx.recipe, id: body?.p_recipe_id };
    case 'record_swipes':
      return { accepted: (body?.p_swipes ?? []).length, replayed: 0 };
    case 'undo_swipe':    return { undone: true };
    case 'save_recipe':   return { saved: true, recipeId: body?.p_recipe_id };
    case 'unsave_recipe': return { saved: false, recipeId: body?.p_recipe_id };
    case 'record_cook':   return { recorded: true };
    case 'less_like_this':return { recorded: true };
    case 'me':            return null;
    default:              return null;
  }
}

createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = raw ? JSON.parse(raw) : null;

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      if (process.env.DEV_LOG) console.log(name, JSON.stringify(body)?.slice(0, 160));
      res.writeHead(200, cors);
      return res.end(JSON.stringify(rpc(name, body)));
    }
    // bare table reads (saves, collections, recipes) return empty sets
    res.writeHead(200, cors);
    res.end('[]');
  });
}).listen(PORT, () => console.log(`devserver on http://localhost:${PORT}`));
