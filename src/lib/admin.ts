import { supabase } from './supabase';

export { relativeTime } from './time';

/** Client wrapper for the admin RPCs. Every one is role-gated server-side. */

export type AdminRole = 'moderator' | 'content_admin' | 'super_admin';

export type AdminStats = {
  openReports: number; highPriorityOpen: number; overdue: number;
  openAppeals: number; copyrightOpen: number;
  publishedRecipes: number; removedRecipes: number;
  totalUsers: number; suspendedUsers: number; actionsLast7d: number;
};

export type QueuedReport = {
  id: string; reason: string; priority: 'high' | 'normal'; status: string;
  details: string | null; targetType: 'recipe' | 'user' | 'cook_photo';
  targetId: string; createdAt: string; ageHours: number; slaHours: number;
  overdue: boolean; reportCount: number;
  targetTitle: string | null; targetCreator: string | null;
  reporter: { username: string; email: string | null } | null;
};

export type ReportDetail = QueuedReport & {
  recipe: {
    id: string; title: string; description: string | null;
    coverImageUrl: string | null; status: string; moderationState: string;
    creator: { id: string; username: string; displayName: string; isSeed: boolean };
    ingredients: string[]; steps: string[];
  } | null;
  user: {
    id: string; username: string; displayName: string; bio: string | null;
    status: string; recipeCount: number; strikes: number;
  } | null;
  otherReports: { reason: string; details: string | null; createdAt: string }[];
  priorActions: { action: string; reason: string | null; createdAt: string }[];
};

export type ModerationAction =
  | 'dismiss' | 'remove' | 'restrict' | 'warn' | 'suspend' | 'ban' | 'reinstate';

export type Appeal = {
  id: string; statement: string; status: string; createdAt: string;
  user: { username: string; displayName: string };
  action: { action: string; reason: string | null; targetType: string; targetId: string };
  sameModerator: boolean;
};

export type AdminAccount = {
  userId: string; role: AdminRole; createdAt: string;
  username: string; displayName: string; email: string | null; grantedBy: string | null;
};

export type FoundUser = {
  id: string; username: string; displayName: string;
  email: string; status: string; role: AdminRole | null;
};

export type AuditEntry = {
  id: string; action: string; targetType: string | null; targetId: string | null;
  metadata: Record<string, unknown>; createdAt: string; actor: string | null;
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // 42501 is the server refusing on role; say so plainly.
    throw new Error(/not authorised/i.test(error.message)
      ? 'Your account does not have permission for that.'
      : error.message);
  }
  return data as T;
}

export const adminStats = () => rpc<AdminStats>('admin_stats');
export const adminReports = (status = 'open') =>
  rpc<QueuedReport[]>('admin_reports', { p_status: status });
export const adminReportDetail = (id: string) =>
  rpc<ReportDetail>('admin_report_detail', { p_report_id: id });
export const adminAct = (
  reportId: string, action: ModerationAction, reason: string, notes?: string,
) => rpc<{ ok: boolean }>('admin_act', {
  p_report_id: reportId, p_action: action, p_reason: reason, p_notes: notes ?? null,
});
export const adminAppeals = (status = 'open') =>
  rpc<Appeal[]>('admin_appeals', { p_status: status });
export const adminResolveAppeal = (id: string, uphold: boolean, outcome: string) =>
  rpc<{ ok: boolean }>('admin_resolve_appeal', {
    p_appeal_id: id, p_uphold: uphold, p_outcome: outcome,
  });
export const adminListAdmins = () => rpc<AdminAccount[]>('admin_list_admins');
export const adminFindUser = (q: string) => rpc<FoundUser[]>('admin_find_user', { p_query: q });
export const adminGrantRole = (userId: string, role: AdminRole) =>
  rpc<{ ok: boolean }>('admin_grant_role', { p_user_id: userId, p_role: role });
export const adminRevokeRole = (userId: string) =>
  rpc<{ ok: boolean }>('admin_revoke_role', { p_user_id: userId });
export const adminAudit = (limit = 100) => rpc<AuditEntry[]>('admin_audit', { p_limit: limit });

export const ROLE_LABELS: Record<AdminRole, string> = {
  moderator: 'Moderator',
  content_admin: 'Content admin',
  super_admin: 'Super admin',
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  moderator: 'Reviews the report queue and takes action. No access to emails or roles.',
  content_admin: 'Everything a moderator can do, plus copyright complaints.',
  super_admin: 'Full access, including granting roles and reading the audit log.',
};

// ---------------------------------------------------------------- user admin

export type UserStatus = 'active' | 'suspended' | 'banned' | 'deleted';

export type AdminUserRow = {
  id: string; username: string; displayName: string;
  /** Only populated for super admins — §29 keeps PII off the moderator surface. */
  email: string | null;
  status: UserStatus; isCreator: boolean; isSeedAccount: boolean;
  deletedAt: string | null; createdAt: string; lastActiveAt: string | null;
  adminRole: AdminRole | null;
  recipeCount: number; saveCount: number; strikes: number; reportsAgainst: number;
};

export type AdminUserPage = { total: number; users: AdminUserRow[] };

export type AdminUserDetail = {
  id: string; username: string; displayName: string; email: string | null;
  bio: string | null; status: UserStatus; isCreator: boolean; isSeedAccount: boolean;
  ageBand: string | null; createdAt: string; deletedAt: string | null;
  lastActiveAt: string | null; adminRole: AdminRole | null;
  counts: {
    recipes: number; published: number; saves: number; cooks: number;
    collections: number; reportsFiled: number; reportsAgainst: number;
  };
  recipes: {
    id: string; title: string; status: string; moderationState: string;
    coverImageUrl: string | null; createdAt: string;
  }[];
  strikes: { reason: string; createdAt: string }[];
  reports: {
    id: string; reason: string; status: string; details: string | null;
    createdAt: string; targetType: string;
  }[];
  moderationHistory: {
    action: string; reason: string | null; targetType: string;
    createdAt: string; moderator: string | null;
  }[];
};

export const adminUsers = (
  query = '', status = 'all', limit = 50, offset = 0,
) => rpc<AdminUserPage>('admin_users', {
  p_query: query, p_status: status, p_limit: limit, p_offset: offset,
});
export const adminUserDetail = (id: string) =>
  rpc<AdminUserDetail>('admin_user_detail', { p_user_id: id });
export const adminSetUserStatus = (
  id: string, status: 'active' | 'suspended' | 'banned', reason: string,
) => rpc<{ ok: boolean; status: string }>('admin_set_user_status', {
  p_user_id: id, p_status: status, p_reason: reason,
});
export const adminDeleteUser = (id: string, reason: string) =>
  rpc<{ ok: boolean; recipesDeleted: number }>('admin_delete_user', {
    p_user_id: id, p_reason: reason,
  });

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  banned: 'Banned',
  deleted: 'Deleted',
};
