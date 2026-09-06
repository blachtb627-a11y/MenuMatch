-- Moderation, appeals, copyright, notifications, audit log.
-- Spec refs: §18.2, §20, §25, §29, Appendix D.

create type report_reason as enum
  ('unsafe_food','copyright','impersonation','harassment','sexual','spam','not_recipe','other');
create type report_status as enum ('open','triaged','resolved','dismissed');
create type moderation_action_type as enum
  ('dismiss','remove','restrict','warn','suspend','ban','shadow_limit','reinstate');
create type appeal_status as enum ('open','under_review','upheld','denied');
create type notification_type as enum
  ('new_recipe_from_creator','new_follower','recipe_cooked','moderation_result','system');

-- Appendix D drives queue priority; high-priority reasons carry the 24h SLA (§20.3).
create or replace function public.report_priority(r report_reason)
returns text language sql immutable parallel safe as $$
  select case when r in ('unsafe_food','copyright','impersonation','harassment','sexual')
              then 'high' else 'normal' end;
$$;

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.users(id) on delete set null,
  target_type text not null check (target_type in ('recipe','user','cook_photo')),
  target_id   uuid not null,
  reason      report_reason not null,
  details     text check (length(details) <= 1000),
  status      report_status not null default 'open',
  priority    text generated always as (public.report_priority(reason)) stored,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index reports_queue_idx on public.reports(status, priority, created_at);
create index reports_target_idx on public.reports(target_type, target_id);

create table public.moderation_actions (
  id           uuid primary key default gen_random_uuid(),
  moderator_id uuid references public.users(id) on delete set null,
  target_type  text not null check (target_type in ('recipe','user','cook_photo')),
  target_id    uuid not null,
  action       moderation_action_type not null,
  reason       text,
  notes        text,
  report_id    uuid references public.reports(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions(target_type, target_id);

-- §20.5: every enforcement action is appealable.
create table public.appeals (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  moderation_action_id uuid not null references public.moderation_actions(id) on delete cascade,
  statement            text not null check (length(statement) between 1 and 2000),
  status               appeal_status not null default 'open',
  reviewed_by          uuid references public.users(id) on delete set null,
  outcome              text,
  created_at           timestamptz not null default now(),
  unique (user_id, moderation_action_id)
);
create index appeals_queue_idx on public.appeals(status, created_at);

-- §18.2: a dedicated path, distinct from general content reports.
create table public.copyright_complaints (
  id                 uuid primary key default gen_random_uuid(),
  claimant_name      text not null,
  claimant_email     text not null,
  claimant_user_id   uuid references public.users(id) on delete set null,
  recipe_id          uuid references public.recipes(id) on delete set null,
  original_work_url  text,
  original_work_description text not null,
  good_faith_statement boolean not null default false,
  accuracy_statement   boolean not null default false,
  signature          text not null,
  status             report_status not null default 'open',
  resolved_by        uuid references public.users(id) on delete set null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint copyright_requires_statements
    check (good_faith_statement and accuracy_statement)
);
create index copyright_complaints_queue_idx on public.copyright_complaints(status, created_at);

-- §18.2 repeat infringer policy: strikes are tracked with defined consequences.
create table public.user_strikes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  reason      report_reason not null,
  action_id   uuid references public.moderation_actions(id) on delete set null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index user_strikes_user_idx on public.user_strikes(user_id, created_at desc);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       notification_type not null,
  actor_id   uuid references public.users(id) on delete set null,
  recipe_id  uuid references public.recipes(id) on delete set null,
  body       text,
  -- deep link target so the notification opens the object, not the app (§25)
  deep_link  text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.notification_preferences (
  user_id    uuid primary key references public.users(id) on delete cascade,
  new_recipe_from_creator boolean not null default true,
  new_follower            boolean not null default true,
  recipe_cooked           boolean not null default true,
  moderation_result       boolean not null default true,
  system                  boolean not null default true,
  -- §25: quiet hours respected by default, no pushes 10pm-8am local
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start   int not null default 22 check (quiet_hours_start between 0 and 23),
  quiet_hours_end     int not null default 8  check (quiet_hours_end between 0 and 23),
  updated_at timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- §29: every admin action writes here. No exceptions, including super admins.
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users(id) on delete set null,
  actor_type  actor_type not null default 'user',
  action      text not null,
  target_type text,
  target_id   uuid,
  metadata    jsonb not null default '{}',
  ip          inet,
  created_at  timestamptz not null default now()
);
create index audit_log_actor_idx on public.audit_log(actor_id, created_at desc);
create index audit_log_target_idx on public.audit_log(target_type, target_id, created_at desc);

-- §29 role-based admin access. A moderator must not reach billing or PII
-- beyond what a report requires.
create table public.admin_roles (
  user_id    uuid primary key references public.users(id) on delete cascade,
  role       text not null check (role in ('moderator','content_admin','super_admin')),
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin(min_role text default 'moderator')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_roles ar
    where ar.user_id = (select public.current_user_id())
      and case min_role
            when 'moderator'     then true
            when 'content_admin' then ar.role in ('content_admin','super_admin')
            when 'super_admin'   then ar.role = 'super_admin'
            else false
          end
  );
$$;
