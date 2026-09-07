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
    case 'me':            return { id: '00000000-0000-4000-8000-0000000000bb',
                                    username: 'devuser', displayName: 'Dev User',
                                    email: 'dev@example.com', savedCount: 0,
                                    isAdmin: true, adminRole: 'super_admin',
                                    preferences: {} };
    case 'my_recipes':    return [];
    case 'admin_stats':   return { openReports: 2, highPriorityOpen: 1, overdue: 1,
                                   openAppeals: 1, copyrightOpen: 0, publishedRecipes: 32,
                                   removedRecipes: 0, totalUsers: 1, suspendedUsers: 0,
                                   actionsLast7d: 0 };
    case 'admin_reports': return [
      { id: 'r1', reason: 'unsafe_food', priority: 'high', status: 'open',
        details: 'Says to water-bath can green beans, that is botulism risk.',
        targetType: 'recipe', targetId: 'rec1',
        createdAt: new Date(Date.now() - 36e5 * 30).toISOString(),
        ageHours: 30, slaHours: 24, overdue: true, reportCount: 2,
        targetTitle: 'Home Canned Green Beans', targetCreator: 'someone',
        reporter: { username: 'reporter1', email: 'r@example.com' } },
      { id: 'r2', reason: 'spam', priority: 'normal', status: 'open', details: null,
        targetType: 'user', targetId: 'usr1',
        createdAt: new Date(Date.now() - 36e5 * 4).toISOString(),
        ageHours: 4, slaHours: 72, overdue: false, reportCount: 1,
        targetTitle: 'Link Spammer', targetCreator: 'spammer',
        reporter: { username: 'reporter2', email: null } }];
    case 'admin_report_detail': return {
      id: 'r1', reason: 'unsafe_food', priority: 'high', status: 'open',
      details: 'Says to water-bath can green beans, that is botulism risk.',
      targetType: 'recipe', targetId: 'rec1', createdAt: new Date().toISOString(),
      ageHours: 30, slaHours: 24, overdue: true, reportCount: 2,
      targetTitle: 'Home Canned Green Beans', targetCreator: 'someone',
      reporter: { username: 'reporter1', email: 'r@example.com' },
      recipe: { id: 'rec1', title: 'Home Canned Green Beans',
                description: 'Grandma\u2019s method.', coverImageUrl: null,
                status: 'published', moderationState: 'clear',
                creator: { id: 'u1', username: 'someone', displayName: 'Someone', isSeed: false },
                ingredients: ['green beans', 'salt', 'water'],
                steps: ['Pack jars.', 'Boil in a water bath for 25 minutes.'] },
      user: null, otherReports: [{ reason: 'unsafe_food', details: 'Same concern', createdAt: new Date().toISOString() }],
      priorActions: [] };
    case 'admin_act':     return { ok: true, actionId: 'a1' };
    case 'admin_appeals': return [
      { id: 'ap1', statement: 'I followed a tested USDA recipe, this was a mistake.',
        status: 'open', createdAt: new Date().toISOString(),
        user: { username: 'someone', displayName: 'Someone' },
        action: { action: 'remove', reason: 'Unsafe canning', targetType: 'recipe', targetId: 'rec1' },
        sameModerator: true }];
    case 'admin_list_admins': return [
      { userId: 'u-me', role: 'super_admin', createdAt: new Date().toISOString(),
        username: 'blachtb627', displayName: 'blachtb627',
        email: 'blachtb627@gmail.com', grantedBy: null }];
    case 'admin_find_user': return [
      { id: 'u2', username: 'sofia.reyes', displayName: 'Sofia Reyes',
        email: 'sofia@example.com', status: 'active', role: null }];
    case 'admin_grant_role':  return { ok: true };
    case 'admin_revoke_role': return { ok: true };
    case 'admin_audit':   return [
      { id: 'al1', action: 'moderation.remove', targetType: 'recipe', targetId: 'rec1',
        metadata: { reason: 'Unsafe canning' }, createdAt: new Date().toISOString(),
        actor: 'blachtb627' }];
    case 'save_draft':    return { id: '00000000-0000-4000-8000-0000000000cc',
                                   savedAt: new Date().toISOString() };
    case 'get_draft':     return null;
    case 'publish_recipe':return { published: false,
                                   missing: ['cover photo', 'rights confirmation'] };
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

    // Mimics GoTrue with "Confirm email" enabled: the account is created and a
    // user is returned, but the session is withheld until the link is clicked.
    // This is the exact response that used to strand people on a signed-out deck.
    if (url.pathname === '/auth/v1/signup') {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({
        user: {
          id: '00000000-0000-4000-8000-0000000000aa',
          aud: 'authenticated', role: '', email: body?.email ?? '',
          email_confirmed_at: null,
          confirmation_sent_at: new Date().toISOString(),
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {}, identities: [],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
        session: null,
      }));
    }
    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/user') {
      const now = Math.floor(Date.now() / 1000);
      const user = {
        id: '00000000-0000-4000-8000-0000000000bb', aud: 'authenticated',
        role: 'authenticated', email: 'dev@example.com',
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'email' }, user_metadata: {}, identities: [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      res.writeHead(200, cors);
      return res.end(JSON.stringify(
        url.pathname === '/auth/v1/user' ? user : {
          access_token: 'dev.dev.dev', token_type: 'bearer', expires_in: 3600,
          expires_at: now + 3600, refresh_token: 'dev-refresh', user,
        }));
    }
    if (url.pathname === '/auth/v1/resend') {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({}));
    }

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      if (process.env.DEV_LOG) console.log(name, JSON.stringify(body)?.slice(0, 160));
      res.writeHead(200, cors);
      return res.end(JSON.stringify(rpc(name, body)));
    }
    if (url.pathname.startsWith('/rest/v1/tags')) {
      res.writeHead(200, cors);
      return res.end(JSON.stringify([
        { slug: 'vegetarian', name: 'Vegetarian', type: 'dietary' },
        { slug: 'gluten-free', name: 'Gluten-free', type: 'dietary' },
        { slug: 'sheet-pan', name: 'Sheet pan', type: 'equipment' },
        { slug: 'weeknight', name: 'Weeknight', type: 'occasion' },
      ]));
    }

    // bare table reads (saves, collections, recipes) return empty sets
    res.writeHead(200, cors);
    res.end('[]');
  });
}).listen(PORT, () => console.log(`devserver on http://localhost:${PORT}`));
