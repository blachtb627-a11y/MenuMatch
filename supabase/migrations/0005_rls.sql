-- Row level security. §23.2: authorization is enforced server-side and never
-- trusted from the client; blocked users and non-published content are filtered
-- at the query level rather than in application code after retrieval.

-- ---------------------------------------------------------------- helpers

-- §20.1 blocking is bidirectional invisibility.
create or replace function public.is_blocked_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = (select public.current_user_id()) and b.blocked_id = other)
       or (b.blocked_id = (select public.current_user_id()) and b.blocker_id = other)
  );
$$;

-- The single definition of "this recipe is discoverable by the caller".
create or replace function public.recipe_visible(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.recipes r
    where r.id = rid
      and r.deleted_at is null
      and (
        r.creator_id = (select public.current_user_id())
        or (
          r.status = 'published'
          and r.moderation_state in ('clear','flagged')
          and not public.is_blocked_with(r.creator_id)
        )
      )
  );
$$;

alter table public.users                    enable row level security;
alter table public.user_preferences         enable row level security;
alter table public.devices                  enable row level security;
alter table public.categories               enable row level security;
alter table public.app_config               enable row level security;
alter table public.ingredients              enable row level security;
alter table public.tags                     enable row level security;
alter table public.recipes                  enable row level security;
alter table public.recipe_ingredients       enable row level security;
alter table public.recipe_steps             enable row level security;
alter table public.recipe_tags              enable row level security;
alter table public.recipe_media             enable row level security;
alter table public.recipe_versions          enable row level security;
alter table public.recipe_stats             enable row level security;
alter table public.swipes                   enable row level security;
alter table public.user_taste_profile       enable row level security;
alter table public.saves                    enable row level security;
alter table public.cooks                    enable row level security;
alter table public.recipe_opens             enable row level security;
alter table public.collections              enable row level security;
alter table public.collection_items         enable row level security;
alter table public.follows                  enable row level security;
alter table public.blocks                   enable row level security;
alter table public.mutes                    enable row level security;
alter table public.negative_signals         enable row level security;
alter table public.idempotency_keys         enable row level security;
alter table public.reports                  enable row level security;
alter table public.moderation_actions       enable row level security;
alter table public.appeals                  enable row level security;
alter table public.copyright_complaints     enable row level security;
alter table public.user_strikes             enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_log                enable row level security;
alter table public.admin_roles              enable row level security;

-- ---------------------------------------------------------------- users
-- §28.2: email and age band are private. Column privileges keep them off the
-- public profile surface even though the row itself is publicly readable;
-- a user reads their own private fields through public.me().

revoke select on public.users from anon, authenticated;
grant select (id, username, display_name, bio, avatar_url, is_creator,
              is_seed_account, status, created_at) on public.users to anon, authenticated;
grant update (display_name, bio, avatar_url, username) on public.users to authenticated;

create policy users_select_public on public.users for select
  to anon, authenticated
  using (deleted_at is null and status = 'active'
         and not public.is_blocked_with(id));
create policy users_select_self on public.users for select
  to authenticated using (auth_id = auth.uid());
create policy users_update_self on public.users for update
  to authenticated using (auth_id = auth.uid()) with check (auth_id = auth.uid());

create policy user_preferences_own on public.user_preferences for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

-- Devices are written through register_device(); no direct client access.
create policy devices_own on public.devices for select
  to authenticated using (user_id = (select public.current_user_id()));

-- ---------------------------------------------------------------- config (§6)

create policy categories_read on public.categories for select
  to anon, authenticated using (is_enabled);

alter table public.app_config add column is_public boolean not null default false;
update public.app_config set is_public = true where key in ('feature_flags','quick_threshold_minutes');
create policy app_config_read_public on public.app_config for select
  to anon, authenticated using (is_public);

create policy ingredients_read on public.ingredients for select to anon, authenticated using (true);
create policy tags_read on public.tags for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- recipes

create policy recipes_select_visible on public.recipes for select
  to anon, authenticated
  using (
    deleted_at is null
    and status = 'published'
    and moderation_state in ('clear','flagged')
    and not public.is_blocked_with(creator_id)
  );

create policy recipes_select_own on public.recipes for select
  to authenticated using (creator_id = (select public.current_user_id()));

create policy recipes_insert_own on public.recipes for insert
  to authenticated with check (creator_id = (select public.current_user_id()));

create policy recipes_update_own on public.recipes for update
  to authenticated
  using (creator_id = (select public.current_user_id()) and moderation_state <> 'removed')
  with check (creator_id = (select public.current_user_id()));

create policy recipes_delete_own on public.recipes for delete
  to authenticated using (creator_id = (select public.current_user_id()));

-- A creator must not be able to set their own moderation state, seed flag, or
-- sponsorship. Column privileges enforce that regardless of what the client sends.
revoke update on public.recipes from authenticated;
grant update (title, description, cover_image_url, category, cuisine, prep_minutes,
              cook_minutes, servings, difficulty, primary_protein, attribution,
              rights_confirmed_at, contains_alcohol, nutrition, protein_g,
              status, published_at, deleted_at) on public.recipes to authenticated;

-- Child rows follow the parent recipe's visibility.
create policy recipe_ingredients_read on public.recipe_ingredients for select
  to anon, authenticated using (public.recipe_visible(recipe_id));
create policy recipe_ingredients_write on public.recipe_ingredients for all
  to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())))
  with check (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())));

create policy recipe_steps_read on public.recipe_steps for select
  to anon, authenticated using (public.recipe_visible(recipe_id));
create policy recipe_steps_write on public.recipe_steps for all
  to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())))
  with check (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())));

create policy recipe_tags_read on public.recipe_tags for select
  to anon, authenticated using (public.recipe_visible(recipe_id));
create policy recipe_tags_write on public.recipe_tags for all
  to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())))
  with check (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())));

create policy recipe_media_read on public.recipe_media for select
  to anon, authenticated using (public.recipe_visible(recipe_id));
create policy recipe_media_write on public.recipe_media for all
  to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())))
  with check (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())));

-- §16: save and cook counts are public. Impressions and passes are not exposed
-- to the client; column privileges keep them internal to ranking.
revoke select on public.recipe_stats from anon, authenticated;
grant select (recipe_id, save_count, cook_count) on public.recipe_stats to anon, authenticated;
create policy recipe_stats_read on public.recipe_stats for select
  to anon, authenticated using (public.recipe_visible(recipe_id));

-- Edit history is moderation material, not public.
create policy recipe_versions_own on public.recipe_versions for select
  to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id and r.creator_id = (select public.current_user_id())));

-- ---------------------------------------------------------------- engagement

create policy swipes_own on public.swipes for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy taste_profile_own on public.user_taste_profile for select
  to authenticated using (user_id = (select public.current_user_id()));

create policy saves_own on public.saves for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy cooks_read on public.cooks for select
  to anon, authenticated using (public.recipe_visible(recipe_id));
create policy cooks_write_own on public.cooks for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy recipe_opens_own on public.recipe_opens for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy collections_own on public.collections for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy collection_items_own on public.collection_items for all
  to authenticated
  using (exists (select 1 from public.collections c
                 where c.id = collection_id and c.user_id = (select public.current_user_id())))
  with check (exists (select 1 from public.collections c
                 where c.id = collection_id and c.user_id = (select public.current_user_id())));

create policy follows_read on public.follows for select to anon, authenticated using (true);
create policy follows_write_own on public.follows for all
  to authenticated
  using (follower_id = (select public.current_user_id()))
  with check (follower_id = (select public.current_user_id())
              and not public.is_blocked_with(following_id));

create policy blocks_own on public.blocks for all
  to authenticated
  using (blocker_id = (select public.current_user_id()))
  with check (blocker_id = (select public.current_user_id()));

create policy mutes_own on public.mutes for all
  to authenticated
  using (muter_id = (select public.current_user_id()))
  with check (muter_id = (select public.current_user_id()));

create policy negative_signals_own on public.negative_signals for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy idempotency_own on public.idempotency_keys for select
  to authenticated using (user_id = (select public.current_user_id()));

-- ---------------------------------------------------------------- trust & safety

create policy reports_insert_own on public.reports for insert
  to authenticated with check (reporter_id = (select public.current_user_id()));
create policy reports_select_own on public.reports for select
  to authenticated using (reporter_id = (select public.current_user_id()));
create policy reports_admin on public.reports for all
  to authenticated using (public.is_admin('moderator')) with check (public.is_admin('moderator'));

create policy moderation_actions_admin on public.moderation_actions for all
  to authenticated using (public.is_admin('moderator')) with check (public.is_admin('moderator'));

-- A user can see and appeal enforcement taken against them.
create policy appeals_own on public.appeals for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));
create policy appeals_admin on public.appeals for all
  to authenticated using (public.is_admin('moderator')) with check (public.is_admin('moderator'));

-- §18.2: anyone may file a copyright complaint, including non-users.
create policy copyright_insert on public.copyright_complaints for insert
  to anon, authenticated with check (true);
create policy copyright_admin on public.copyright_complaints for all
  to authenticated using (public.is_admin('content_admin')) with check (public.is_admin('content_admin'));

create policy strikes_own_read on public.user_strikes for select
  to authenticated using (user_id = (select public.current_user_id()));
create policy strikes_admin on public.user_strikes for all
  to authenticated using (public.is_admin('moderator')) with check (public.is_admin('moderator'));

create policy notifications_own on public.notifications for select
  to authenticated using (user_id = (select public.current_user_id()));
create policy notifications_mark_read on public.notifications for update
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy notification_prefs_own on public.notification_preferences for all
  to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

-- §29: the audit log is append-only from the server and readable by admins only.
create policy audit_log_admin_read on public.audit_log for select
  to authenticated using (public.is_admin('super_admin'));

create policy admin_roles_read_self on public.admin_roles for select
  to authenticated using (user_id = (select public.current_user_id()));
