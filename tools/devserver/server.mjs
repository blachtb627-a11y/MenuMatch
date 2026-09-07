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

// In-memory collection state so the picker and reorder can be exercised.
/** 2x2 mint PNG — enough to prove an image rendered rather than fell back. */
const DEV_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAHUlEQVR42mP8z8BQz0AEYBxVSF+F'
  + 'jIwMDAwMDAwMAB8sBAX7l6JnAAAAAElFTkSuQmCC', 'base64');

const DEV = {
  profile: { displayName: 'Dev User', bio: null, avatarUrl: null },
  problemReports: [],
  collections: [
    { id: 'col1', name: 'Weeknight Dinners', visibility: 'private' },
    { id: 'col2', name: 'Want to Try', visibility: 'private' },
  ],
  items: { col1: [], col2: [] },
  deadSaves: 2,
  prefs: {
    dietaryTags: ['vegetarian'], favoriteCategories: [],
    dislikedIngredients: ['coriander'], cuisines: ['Italian'],
    skillLevel: null, unitsPreference: 'original', onboardingComplete: true,
  },
  blocks: [],
  myRecipes: [
    { id: 'draft-1', title: 'Nonna\u2019s ragu', status: 'draft',
      coverImageUrl: 'http://localhost:8787/storage/v1/object/public/recipe-media/u-me/covers/ragu.jpg',
      totalMinutes: 210, updatedAt: new Date().toISOString(),
      ingredientCount: 11, stepCount: 7, saveCount: 0 },
    { id: 'draft-2', title: '', status: 'draft', coverImageUrl: null,
      totalMinutes: 0, updatedAt: new Date().toISOString(),
      ingredientCount: 0, stepCount: 0, saveCount: 0 },
    { id: 'pub-1', title: 'Charred cabbage with brown butter', status: 'published',
      coverImageUrl: null, totalMinutes: 35, updatedAt: new Date().toISOString(),
      ingredientCount: 8, stepCount: 5, saveCount: 412 },
  ],
  adminUsers: [
    { id: 'u-me', username: 'blachtb627', displayName: 'blachtb627',
      email: 'blachtb627@gmail.com', status: 'active', isCreator: true,
      isSeedAccount: false, deletedAt: null,
      createdAt: '2026-01-04T10:00:00Z', lastActiveAt: new Date().toISOString(),
      adminRole: 'super_admin', recipeCount: 4, saveCount: 21, strikes: 0, reportsAgainst: 0 },
    { id: 'u2', username: 'sofia.reyes', displayName: 'Sofia Reyes',
      email: 'sofia@example.com', status: 'active', isCreator: true,
      isSeedAccount: false, deletedAt: null,
      createdAt: '2026-03-11T10:00:00Z',
      lastActiveAt: new Date(Date.now() - 3 * 864e5).toISOString(),
      adminRole: null, recipeCount: 12, saveCount: 64, strikes: 0, reportsAgainst: 0 },
    { id: 'u3', username: 'linkspammer', displayName: 'Deals Daily',
      email: 'deals@example.com', status: 'active', isCreator: false,
      isSeedAccount: false, deletedAt: null,
      createdAt: '2026-08-30T10:00:00Z',
      lastActiveAt: new Date(Date.now() - 40 * 6e4).toISOString(),
      adminRole: null, recipeCount: 2, saveCount: 0, strikes: 1, reportsAgainst: 3 },
    { id: 'u5', username: 'fake.seed', displayName: 'Fake Seed',
      email: 'seed@example.com', status: 'deleted', isCreator: true,
      isSeedAccount: true, deletedAt: new Date().toISOString(),
      createdAt: '2025-10-02T10:00:00Z', lastActiveAt: null,
      adminRole: null, recipeCount: 0, saveCount: 0, strikes: 0, reportsAgainst: 0 },
    { id: 'u4', username: 'old.account', displayName: 'Marek Novak',
      email: 'marek@example.com', status: 'suspended', isCreator: false,
      isSeedAccount: false, deletedAt: null,
      createdAt: '2025-11-02T10:00:00Z',
      lastActiveAt: new Date(Date.now() - 200 * 864e5).toISOString(),
      adminRole: null, recipeCount: 0, saveCount: 9, strikes: 2, reportsAgainst: 1 },
  ],
};

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
      // A deleted recipe comes back marked unavailable, as the real RPC does.
      if (String(body?.p_recipe_id).startsWith('gone-')) {
        return { id: body?.p_recipe_id, unavailable: true, title: '' };
      }
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
    case 'me':            return { id: 'u-me',
                                    username: 'devuser',
                                    displayName: DEV.profile.displayName,
                                    email: 'dev@example.com', savedCount: 0,
                                    bio: DEV.profile.bio, avatarUrl: DEV.profile.avatarUrl,
                                    isAdmin: true, adminRole: 'super_admin',
                                    preferences: {} };
    case 'my_recipes':    return DEV.myRecipes;
    case 'my_preferences': return DEV.prefs;
    case 'save_preferences': {
      DEV.prefs = { ...DEV.prefs, ...(body?.p ?? {}) };
      return DEV.prefs;
    }
    case 'my_blocks': return DEV.blocks;
    case 'block_user': {
      if (!DEV.blocks.some((b) => b.id === body?.p_user_id)) {
        DEV.blocks = [...DEV.blocks, { id: body?.p_user_id, username: 'sofia.reyes',
          displayName: 'Sofia Reyes', blockedAt: new Date().toISOString() }];
      }
      return { blocked: true };
    }
    case 'unblock_user': {
      DEV.blocks = DEV.blocks.filter((b) => b.id !== body?.p_user_id);
      return { blocked: false };
    }
    case 'is_blocked_by_me':
      return DEV.blocks.some((b) => b.id === body?.p_user_id);
    case 'export_my_data': return {
      exportedAt: new Date().toISOString(),
      account: { id: 'u-me', username: 'devuser', displayName: 'Dev User',
                 email: 'dev@example.com' },
      preferences: DEV.prefs,
      recipes: [{ id: 'rec1', title: 'Charred cabbage with brown butter' }],
      saves: [{ recipeId: 'rec1', title: 'Charred cabbage', savedAt: new Date().toISOString() }],
      collections: [{ name: 'Weeknight Dinners', recipes: [] }],
      cooks: [],
      blocked: DEV.blocks,
      swipes: { total: 42, mostRecent: [] },
    };
    case 'report_problem': {
      const t = body?.p_target_type;
      if (t !== 'user' && t !== 'app') throw new Error('bad target');
      if (t === 'user' && !body?.p_target_id) throw new Error('no account named');
      const key = `${t}:${body?.p_target_id ?? ''}`;
      const dup = DEV.problemReports.includes(key);
      if (!dup) DEV.problemReports = [...DEV.problemReports, key];
      return { ok: true, id: 'rep-' + DEV.problemReports.length, duplicate: dup };
    }
    case 'search_all': {
      const q = String(body?.p_query ?? '').toLowerCase();
      const cap = body?.p_max_minutes;
      const creators = [
        { id: 'u2', username: 'sofia.reyes', displayName: 'Sofia Reyes',
          bio: 'Weeknight cooking, mostly one pan.', avatarUrl: null,
          isSeedAccount: false, recipes: 12, saves: 1840 },
        { id: 'u3', username: 'marco.rossi', displayName: 'Marco Rossi',
          bio: null, avatarUrl: null, isSeedAccount: false, recipes: 3, saves: 12 },
      ].filter((c) => c.username.includes(q) || c.displayName.toLowerCase().includes(q));
      const recipes = [
        { id: 'rec1', title: 'Charred cabbage with brown butter', coverImageUrl: null,
          totalMinutes: 35, cuisine: 'British', saveCount: 412,
          creator: { id: 'u2', username: 'sofia.reyes', displayName: 'Sofia Reyes' } },
        { id: 'rec2', title: 'Slow ragu', coverImageUrl: null,
          totalMinutes: 200, cuisine: 'Italian', saveCount: 7,
          creator: { id: 'u3', username: 'marco.rossi', displayName: 'Marco Rossi' } },
      ].filter((r) => (r.title.toLowerCase().includes(q)
                       || r.cuisine.toLowerCase().includes(q)
                       || r.creator.username.includes(q))
                    && (!cap || r.totalMinutes <= cap));
      return { recipes, creators };
    }
    case 'creator_profile': {
      return {
        id: body?.p_creator, username: 'sofia.reyes', displayName: 'Sofia Reyes',
        bio: 'Weeknight cooking, mostly one pan.', avatarUrl: null,
        isSeedAccount: false, joinedAt: '2026-03-11T10:00:00Z', saves: 1840,
        recipes: [
          { id: 'rec1', title: 'Charred cabbage with brown butter', coverImageUrl: null,
            totalMinutes: 35, cuisine: 'British', saveCount: 412 },
          { id: 'rec3', title: 'Lemon orzo', coverImageUrl: null,
            totalMinutes: 25, cuisine: 'Greek', saveCount: 88 },
        ],
      };
    }
    case 'delete_recipe': {
      const r = DEV.myRecipes.find((x) => x.id === body?.p_recipe_id);
      if (!r) throw new Error('recipe not found');
      DEV.myRecipes = DEV.myRecipes.filter((x) => x.id !== r.id);
      const hard = r.status === 'draft';
      return { deleted: true, id: r.id, hard,
               coverImageUrl: hard ? r.coverImageUrl : null,
               savedByOthers: hard ? 0 : 4 };
    }
    case 'unpublish_recipe': {
      const r = DEV.myRecipes.find((x) => x.id === body?.p_recipe_id);
      if (!r) throw new Error('recipe not found');
      r.status = 'unpublished';
      return { published: false };
    }
    case 'prune_dead_saves': {
      const before = DEV.deadSaves;
      DEV.deadSaves = 0;
      return { saves: before, collectionItems: 0 };
    }
    case 'my_collections': return DEV.collections.map((c) => ({
      ...c, recipeCount: (DEV.items[c.id] ?? []).length, coverImageUrl: null }));
    case 'recipe_collections': return DEV.collections
      .filter((c) => (DEV.items[c.id] ?? []).includes(body?.p_recipe_id))
      .map((c) => c.id);
    case 'create_collection': {
      const existing = DEV.collections.find((c) => c.name === body?.p_name);
      if (existing) return { id: existing.id, existed: true };
      const c = { id: 'col' + (DEV.collections.length + 1), name: body.p_name,
                  visibility: 'private' };
      DEV.collections.push(c); DEV.items[c.id] = [];
      return { id: c.id, existed: false };
    }
    case 'rename_collection': {
      const c = DEV.collections.find((x) => x.id === body?.p_id);
      if (DEV.collections.some((x) => x.name === body?.p_name && x.id !== body?.p_id)) {
        throw new Error('duplicate');
      }
      if (c) c.name = body.p_name;
      return { ok: true, name: body?.p_name };
    }
    case 'delete_collection': {
      DEV.collections = DEV.collections.filter((c) => c.id !== body?.p_id);
      delete DEV.items[body?.p_id];
      return { ok: true };
    }
    case 'set_recipe_collections': {
      const ids = body?.p_collection_ids ?? [];
      for (const c of DEV.collections) {
        const has = ids.includes(c.id);
        const list = DEV.items[c.id] ?? (DEV.items[c.id] = []);
        const at = list.indexOf(body.p_recipe_id);
        if (has && at === -1) list.push(body.p_recipe_id);
        if (!has && at !== -1) list.splice(at, 1);
      }
      return { ok: true };
    }
    case 'remove_from_collection': {
      const list = DEV.items[body?.p_collection_id] ?? [];
      const at = list.indexOf(body?.p_recipe_id);
      if (at !== -1) list.splice(at, 1);
      return { ok: true };
    }
    case 'reorder_collection_item': {
      const list = DEV.items[body?.p_collection_id] ?? [];
      const at = list.indexOf(body?.p_recipe_id);
      const to = at + (body?.p_direction ?? 0);
      if (at === -1 || to < 0 || to >= list.length) return { ok: true, moved: false };
      [list[at], list[to]] = [list[to], list[at]];
      return { ok: true, moved: true };
    }
    case 'collection_detail': {
      const c = DEV.collections.find((x) => x.id === body?.p_id);
      if (!c) throw new Error('collection not found');
      return { id: c.id, name: c.name, visibility: c.visibility,
               recipes: (DEV.items[c.id] ?? []).map((rid, i) => {
                 const card = fx.feed.cards.find((x) => x.id === rid) ?? fx.recipe;
                 return { ...card, position: i, unavailable: false };
               }) };
    }
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
    case 'admin_users': {
      const q = (body?.p_query ?? '').toLowerCase();
      const st = body?.p_status ?? 'all';
      const rows = DEV.adminUsers
        .filter((u) => st === 'all' || u.status === st)
        .filter((u) => !q || u.username.includes(q) || u.displayName.toLowerCase().includes(q)
                       || (u.email ?? '').toLowerCase().includes(q));
      return { total: rows.length, users: rows };
    }
    case 'admin_user_detail': {
      const u = DEV.adminUsers.find((x) => x.id === body?.p_user_id) ?? DEV.adminUsers[0];
      return {
        ...u, bio: 'Weeknight cooking, mostly one pan.', ageBand: '18_plus',
        counts: { recipes: u.recipeCount, published: u.recipeCount, saves: u.saveCount,
                  cooks: 3, collections: 2, reportsFiled: 0, reportsAgainst: u.reportsAgainst },
        recipes: u.recipeCount
          ? [{ id: 'rec1', title: 'Charred cabbage with brown butter', status: 'published',
               moderationState: 'clear', coverImageUrl: null,
               createdAt: new Date().toISOString() }]
          : [],
        strikes: u.strikes
          ? [{ reason: 'unsafe_food', createdAt: new Date().toISOString() }] : [],
        reports: u.reportsAgainst
          ? [{ id: 'r1', reason: 'spam', status: 'open', details: 'Posts the same link',
               createdAt: new Date().toISOString(), targetType: 'user' }] : [],
        moderationHistory: u.strikes
          ? [{ action: 'warn', reason: 'Unsafe canning', targetType: 'user',
               createdAt: new Date().toISOString(), moderator: 'blachtb627' }] : [],
      };
    }
    case 'admin_set_user_status': {
      const u = DEV.adminUsers.find((x) => x.id === body?.p_user_id);
      if (u) u.status = body?.p_status;
      return { ok: true, status: body?.p_status };
    }
    case 'admin_purge_user': {
      const u = DEV.adminUsers.find((x) => x.id === body?.p_user_id);
      if (!u) throw new Error('user not found');
      if (!u.deletedAt) throw new Error('delete the account first');
      DEV.adminUsers = DEV.adminUsers.filter((x) => x.id !== u.id);
      return { purged: true, username: u.username };
    }
    case 'admin_delete_user': {
      const u = DEV.adminUsers.find((x) => x.id === body?.p_user_id);
      if (u) { u.status = 'deleted'; u.deletedAt = new Date().toISOString(); }
      return { ok: true, recipesDeleted: u?.recipeCount ?? 0 };
    }
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
    case 'get_draft': {
      const r = DEV.myRecipes.find((x) => x.id === body?.p_recipe_id);
      if (!r) return null;
      return {
        id: r.id, title: r.title, description: '', coverImageUrl: r.coverImageUrl,
        category: 'comfort', cuisine: 'Italian', prepMinutes: 25, cookMinutes: 180,
        servings: 6, difficulty: 'medium', attribution: '', nutrition: null,
        status: r.status, rightsConfirmedAt: r.status === 'published'
          ? new Date().toISOString() : null,
        ingredients: [{ quantity: { numerator: 2, denominator: 1 }, unit: 'lb',
                        ingredient: 'beef chuck', note: '' }],
        steps: ['Brown the beef.'], tags: [],
      };
    }
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
  if (req.method === 'OPTIONS') {
    // Echo the requested headers, as the real function now does. DEV_CORS=strict
    // replays the old narrow allow-list so the failure mode stays reproducible.
    const asked = req.headers['access-control-request-headers'];
    res.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Headers': process.env.DEV_CORS === 'strict'
        ? 'authorization, x-client-info, apikey, content-type'
        : (asked || cors['Access-Control-Allow-Headers']),
    });
    return res.end();
  }

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Storage uploads arrive as multipart, so a failed parse is not an error.
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }

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
      try {
        const out = rpc(name, body);
        res.writeHead(200, cors);
        return res.end(JSON.stringify(out));
      } catch (e) {
        // PostgREST reports a raised exception as 400 with this body shape.
        res.writeHead(400, cors);
        return res.end(JSON.stringify({ code: 'P0001', message: e.message }));
      }
    }

    // Storage uploads. The real bucket returns the key; the client then builds
    // the public URL from it, so echoing the path is enough to drive the flow.
    if (url.pathname.startsWith('/storage/v1/object/')) {
      // Reading one back has to return bytes, not JSON: an <Image> pointed at
      // a JSON body silently falls back, which looks exactly like an upload
      // that never happened.
      if (req.method === 'GET' && url.pathname.includes('/object/public/')) {
        res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
        return res.end(DEV_PIXEL);
      }
      const key = url.pathname.replace('/storage/v1/object/', '');
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ Key: key, Id: 'dev-object' }));
    }

    // DEV_SCAN=fail replays a server-side failure so the error surfaces.
    if (url.pathname === '/functions/v1/estimate-nutrition') {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({
        nutrition: { perServing: true, calories: 615, proteinG: 42,
                     carbsG: 18, fatG: 39, source: 'estimated' },
        confidence: 'medium',
        assumptions: 'Assumed a standard 400g tin of tomatoes.',
      }));
    }

    // Edge functions. DEV_SCAN=off replays the 503 the real function returns
    // when ANTHROPIC_API_KEY is missing, so both paths can be driven.
    if (url.pathname === '/functions/v1/scan-recipe') {
      if (process.env.DEV_SCAN === 'slow') {
        return setTimeout(() => {
          res.writeHead(504, cors);
          res.end(JSON.stringify({ error: 'model_timeout',
            message: 'The scanner took too long to read that photo.' }));
        }, 8000);
      }
      if (process.env.DEV_SCAN === 'fail') {
        res.writeHead(502, cors);
        return res.end(JSON.stringify({
          error: 'scan_failed', message: 'The model refused that request.' }));
      }
      if (process.env.DEV_SCAN === 'off') {
        res.writeHead(503, cors);
        return res.end(JSON.stringify({
          error: 'not_configured',
          message: 'Recipe scanning is not set up yet. An ANTHROPIC_API_KEY secret needs to be added to this project.',
        }));
      }
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ recipe: {
        title: 'Nonna\u2019s Sunday Ragu',
        description: 'The long-simmered one, written on the back of an envelope.',
        category: 'comfort', cuisine: 'Italian',
        prepMinutes: 25, cookMinutes: 180, servings: 6, difficulty: 'medium',
        // Plain lines now, as the real function returns them.
        ingredients: [
          '2 lb beef chuck, cut into cubes',
          '1/3 cup olive oil',
          '3 cloves garlic, crushed',
          'a pinch of salt',
        ],
        steps: [
          'Brown the beef in the oil, in batches, until deeply coloured.',
          'Add the garlic and cook until fragrant.',
          'Simmer, covered, for three hours.',
        ],
        tags: ['weeknight'],
        nutrition: { perServing: true, calories: 720, proteinG: 48,
                     carbsG: 22, fatG: 44, source: 'scanned' },
        confidence: 'medium',
        notes: 'The oven temperature was smudged \u2014 check it before publishing.',
      } }));
    }
    // Profile edits go straight to the users table (0005 grants exactly those
    // columns), so PATCH lands here rather than on an RPC.
    if (url.pathname.startsWith('/rest/v1/users') && req.method === 'PATCH') {
      const patch = body ?? {};
      if (patch.display_name !== undefined) DEV.profile.displayName = patch.display_name;
      if (patch.bio !== undefined) DEV.profile.bio = patch.bio;
      if (patch.avatar_url !== undefined) DEV.profile.avatarUrl = patch.avatar_url;
      res.writeHead(200, cors);
      return res.end(JSON.stringify([]));
    }
    if (url.pathname.startsWith('/rest/v1/saves')) {
      res.writeHead(200, cors);
      const live = fx.feed.cards.map((c) => ({
        recipe_id: c.id, created_at: new Date().toISOString(),
      }));
      // Two saves point at recipes that no longer resolve.
      const dead = DEV.deadSaves
        ? [{ recipe_id: 'gone-1', created_at: new Date().toISOString() },
           { recipe_id: 'gone-2', created_at: new Date().toISOString() }]
        : [];
      return res.end(JSON.stringify([...live, ...dead]));
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
