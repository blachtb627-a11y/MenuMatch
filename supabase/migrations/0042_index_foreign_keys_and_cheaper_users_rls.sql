-- Housekeeping from the Supabase performance advisor.
--
-- 1. Every foreign key the advisor flagged gets a covering index. Without one,
--    deleting or re-keying the parent row (purging a user, removing a recipe)
--    has to scan the whole child table to check the constraint. The tables
--    are small today, so the cost is invisible now and only shows up later.
--
-- 2. The two self-service policies on `users` called auth.uid() bare, which
--    Postgres re-evaluates for every row it checks. Wrapping it in a scalar
--    subquery lets the planner run it once per statement. Same rule, same
--    rows visible; only the plan changes.
--
-- Left alone on purpose: the "multiple permissive policies" findings (merging
-- them changes who can see what and wants its own careful pass) and the
-- "unused index" findings (search and trigram indexes back features that just
-- haven't had traffic yet).

create index if not exists ad_campaigns_created_by_idx           on public.ad_campaigns (created_by);
create index if not exists admin_roles_granted_by_idx            on public.admin_roles (granted_by);
create index if not exists appeals_moderation_action_id_idx      on public.appeals (moderation_action_id);
create index if not exists appeals_reviewed_by_idx               on public.appeals (reviewed_by);
create index if not exists copyright_complaints_claimant_idx     on public.copyright_complaints (claimant_user_id);
create index if not exists copyright_complaints_recipe_id_idx    on public.copyright_complaints (recipe_id);
create index if not exists copyright_complaints_resolved_by_idx  on public.copyright_complaints (resolved_by);
create index if not exists idempotency_keys_user_id_idx          on public.idempotency_keys (user_id);
create index if not exists moderation_actions_moderator_id_idx   on public.moderation_actions (moderator_id);
create index if not exists moderation_actions_report_id_idx      on public.moderation_actions (report_id);
create index if not exists mutes_muted_id_idx                    on public.mutes (muted_id);
create index if not exists notifications_actor_id_idx            on public.notifications (actor_id);
create index if not exists notifications_recipe_id_idx           on public.notifications (recipe_id);
create index if not exists recipe_opens_recipe_id_idx            on public.recipe_opens (recipe_id);
create index if not exists recipe_versions_edited_by_idx         on public.recipe_versions (edited_by);
create index if not exists reports_reporter_id_idx               on public.reports (reporter_id);
create index if not exists reports_resolved_by_idx               on public.reports (resolved_by);
create index if not exists user_strikes_action_id_idx            on public.user_strikes (action_id);

alter policy users_select_self on public.users
  using (auth_id = (select auth.uid()));
alter policy users_update_self on public.users
  using (auth_id = (select auth.uid()))
  with check (auth_id = (select auth.uid()));
