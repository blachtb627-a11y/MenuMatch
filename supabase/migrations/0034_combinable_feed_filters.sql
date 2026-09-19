-- The deck's filter bar was one flat list mixing three unrelated dimensions:
-- meal (dinner, lunch, ...), time (quick) and diet (vegetarian, high_protein).
-- Because get_feed took a single category slug and branched on one feed_kind,
-- they were mutually exclusive by construction — "lunch under 30 minutes" was
-- not expressible.
--
-- p_filters adds three independent predicates, AND-ed with each other and with
-- whatever the category already selects:
--
--   meals       OR within the group   — lunch or dinner
--   diets       AND within the group  — vegetarian *and* gluten-free
--   maxMinutes  a single cap on total_minutes
--
-- Applied by patching the function's own source, the way 0026 did, so the
-- ~300 lines of ranking below cannot be altered by transcription. Every anchor
-- is checked and the migration raises rather than guessing.

do $$
declare
  src text; patched text;

  -- 1. The signature gains the new parameter, defaulted so every existing
  --    four-argument call keeps working.
  a_sig_old text := 'p_exclude uuid[] DEFAULT ''{}''::uuid[])';
  a_sig_new text := 'p_exclude uuid[] DEFAULT ''{}''::uuid[], p_filters jsonb DEFAULT ''{}''::jsonb)';

  -- 2. Parse the filters once, into locals the query below can use.
  a_dec_old text := '  v_relax     int  := 0;';
  a_dec_new text :=
    '  v_meals text[] := coalesce((select array_agg(v) from '
    || 'jsonb_array_elements_text(case when jsonb_typeof(p_filters->''meals'') = ''array'' '
    || 'then p_filters->''meals'' else ''[]''::jsonb end) v), ''{}'');' || E'\n'
    || '  v_diets text[] := coalesce((select array_agg(v) from '
    || 'jsonb_array_elements_text(case when jsonb_typeof(p_filters->''diets'') = ''array'' '
    || 'then p_filters->''diets'' else ''[]''::jsonb end) v), ''{}'');' || E'\n'
    || '  v_max_min int := nullif(p_filters->>''maxMinutes'', '''')::int;' || E'\n'
    || '  v_relax     int  := 0;';

  -- 3. A filtered deck must never widen past its own filters. This is the
  --    same rule 0026 established for categories: run short and say so.
  a_str_old text := 'v_strict := v_cat.feed_kind not in (''for_you'', ''curated'');';
  a_str_new text := 'v_strict := v_cat.feed_kind not in (''for_you'', ''curated'')'
    || ' or v_meals <> ''{}'' or v_diets <> ''{}'' or v_max_min is not null;';

  -- 4. The predicates themselves, AND-ed after the category's own OR-block.
  a_pred_old text :=
    '          or (v_cat.feed_kind = ''nutrition_gated''' || E'\n'
    || '              and r.protein_g is not null' || E'\n'
    || '              and r.protein_g >= coalesce(v_cat.min_protein_g, 20))' || E'\n'
    || '        )';
  a_pred_new text :=
    '          or (v_cat.feed_kind = ''nutrition_gated''' || E'\n'
    || '              and r.protein_g is not null' || E'\n'
    || '              and r.protein_g >= coalesce(v_cat.min_protein_g, 20))' || E'\n'
    || '        )' || E'\n'
    || '        and (v_meals = ''{}'' or r.category = any (v_meals))' || E'\n'
    || '        and (v_max_min is null or r.total_minutes <= v_max_min)' || E'\n'
    -- Every selected diet must be present, not merely one of them: someone who
    -- picks vegetarian and gluten-free wants both to hold.
    || '        and (v_diets = ''{}'' or not exists (' || E'\n'
    || '              select 1 from unnest(v_diets) d' || E'\n'
    || '              where not exists (' || E'\n'
    || '                select 1 from recipe_tags rt join tags t on t.id = rt.tag_id' || E'\n'
    || '                where rt.recipe_id = r.id and t.slug = d)))';

  -- 5. Echo the filters back, so the client can prove what it actually got.
  a_ret_old text := '    ''category'', v_cat.slug,';
  a_ret_new text := '    ''category'', v_cat.slug,' || E'\n'
    || '    ''filters'', coalesce(p_filters, ''{}''::jsonb),';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'get_feed'
     and p.oid::regprocedure::text = 'get_feed(text,integer,text,uuid[])';
  if src is null then
    -- Already applied: the four-argument version is gone.
    if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                where ns.nspname = 'public' and p.proname = 'get_feed'
                  and p.oid::regprocedure::text = 'get_feed(text,integer,text,uuid[],jsonb)')
    then return; end if;
    raise exception 'get_feed: the four-argument version was not found';
  end if;

  patched := src;

  if position(a_sig_old in patched) = 0 then raise exception 'anchor 1 (signature) not found'; end if;
  patched := replace(patched, a_sig_old, a_sig_new);

  if position(a_dec_old in patched) = 0 then raise exception 'anchor 2 (declarations) not found'; end if;
  patched := replace(patched, a_dec_old, a_dec_new);

  if position(a_str_old in patched) = 0 then raise exception 'anchor 3 (v_strict) not found'; end if;
  patched := replace(patched, a_str_old, a_str_new);

  if position(a_pred_old in patched) = 0 then raise exception 'anchor 4 (predicates) not found'; end if;
  patched := replace(patched, a_pred_old, a_pred_new);

  if position(a_ret_old in patched) = 0 then raise exception 'anchor 5 (return) not found'; end if;
  patched := replace(patched, a_ret_old, a_ret_new);

  -- The old four-argument function has to go, or the five-argument one is an
  -- overload and every existing four-argument call becomes ambiguous.
  drop function public.get_feed(text, integer, text, uuid[]);
  execute patched;
end $$;

-- DROP took the grants with it. The deck is reachable to signed-out guests, so
-- anon keeps EXECUTE; the default grant to PUBLIC does not come back.
revoke execute on function public.get_feed(text, integer, text, uuid[], jsonb) from public;
grant  execute on function public.get_feed(text, integer, text, uuid[], jsonb)
  to anon, authenticated;
