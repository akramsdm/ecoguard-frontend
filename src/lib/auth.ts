/**
 * Who counts as EcoGuard staff, and where each account is allowed to land.
 *
 * Kept free of React and of the network so the gate can be unit-tested directly. The
 * server remains the authority: every /admin and /workspace endpoint 401s or 403s a
 * non-staff caller regardless of what this module decides, and a reporter rejected here
 * still holds a valid session that simply cannot enter staff routes.
 */
import type {Role, User} from './types';

/** Roles that unlock the staff workspace. A reporter-only account is not staff. */
export const STAFF_ROLES:readonly Role[] = ['admin', 'reviewer', 'responder', 'publisher'];

/** Route a staff member lands on after signing in through the staff entry point. */
export const STAFF_LANDING = '#/workspace/dashboard';

export const NOT_STAFF_MESSAGE =
  'These credentials are valid, but this account is not staff. ' +
  'Reviewer, responder, publisher and administrator access is assigned by an administrator. ' +
  'Use the community sign-in to report and follow your own cases.';

export function isStaff(roles:readonly Role[] | null | undefined):boolean {
  return !!roles && roles.some((role) => STAFF_ROLES.includes(role));
}

export function isStaffUser(user:User | null | undefined):boolean {
  return !!user && isStaff(user.roles);
}

export type StaffLoginResult =
  |{ok: true; user: User; landing: string}
  |{ok: false; error: string};

/**
 * Decide what happens after the staff login form receives valid credentials.
 *
 * A non-staff account is rejected explicitly rather than being quietly redirected to the
 * community home, so that a reporter who typed their address into the staff form is told
 * why instead of wondering whether they signed in successfully.
 */
export function staffLoginResult(user:User):StaffLoginResult {
  if (!isStaffUser(user)) return {ok: false, error: NOT_STAFF_MESSAGE};
  return {ok: true, user, landing: STAFF_LANDING};
}

/**
 * Whether a #/workspace/* page may be rendered for this account.
 *
 * The shell calls this on every route change, including a URL typed by hand, so a
 * reporter cannot reach a staff page by bypassing the navigation.
 */
export function canRenderWorkspace(user:User | null | undefined):boolean {
  return isStaffUser(user);
}

/** Workspace pages only an administrator may open. */
export const ADMIN_ONLY_PAGES:readonly string[] = ['admin'];

/**
 * Whether this account may open a specific #/workspace/* page.
 *
 * Separate from canRenderWorkspace because the admin overview exposes account and
 * delivery counts. A reviewer who pasted that URL would otherwise load the staff shell
 * and see every failing request in the console; the backend would still 403.
 */
export function canRenderWorkspacePage(user:User | null | undefined, page:string):boolean {
  if (!canRenderWorkspace(user)) return false;
  if (ADMIN_ONLY_PAGES.includes(page)) return !!user && user.roles.includes('admin');
  return true;
}

export type NavItem = readonly[page:string, icon:string, label:string];

/**
 * Insert the administrator entry only for administrators.
 *
 * Kept here rather than inline in the shell so "a reviewer never sees the admin link"
 * is a unit test rather than a claim about a JSX ternary. Any existing admin entry is
 * dropped first, so calling this twice cannot produce a duplicated link.
 */
export function withAdminNav(items:readonly NavItem[], user:User | null | undefined):NavItem[] {
  const base=items.filter(([page])=>!ADMIN_ONLY_PAGES.includes(page));
  if (!user || !user.roles.includes('admin')) return base as NavItem[];
  return [...base, ['admin', 'lock', 'Admin'] as const];
}
