/**
 * The staff gate in src/lib/auth.ts.
 *
 * These assertions cover the behaviour the #/staff/login route depends on: a reporter
 * whose credentials are perfectly valid is refused on the staff entry point, staff roles
 * are admitted, and a non-staff session cannot render a #/workspace/* page even when the
 * URL is typed by hand. The backend 401/403s these callers independently, so this is
 * guarding the user experience, not a security boundary.
 */
import {describe, expect, it} from 'vitest';
import {
  canRenderWorkspace,
  canRenderWorkspacePage,
  withAdminNav,
  isStaff,
  isStaffUser,
  ADMIN_ONLY_PAGES,
  NOT_STAFF_MESSAGE,
  STAFF_LANDING,
  STAFF_ROLES,
  staffLoginResult,
  type NavItem,
} from './auth';
import type {Role, User} from './types';

function account(roles:Role[]):User {
  return {id: 'user-1', name: 'Test Account', email: 'a@example.org', roles,
          areas: ['area-a'], active: true,
          preferences: {followed_areas: [], in_app: true, sms_opt_in: false, language: 'en'}};
}

describe('isStaff', () => {
  it('admits every staff role', () => {
    for (const role of STAFF_ROLES) expect(isStaff([role])).toBe(true);
  });

  it('rejects a reporter-only account', () => {
    expect(isStaff(['reporter'])).toBe(false);
  });

  it('admits an account that also reports, as long as one role is staff', () => {
    expect(isStaff(['reporter', 'reviewer'])).toBe(true);
  });

  it('treats a missing or empty role list as not staff', () => {
    expect(isStaff([])).toBe(false);
    expect(isStaff(null)).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });

  it('does not match a role that merely contains a staff word', () => {
    expect(isStaff(['superadmin' as Role])).toBe(false);
  });
});

describe('staffLoginResult', () => {
  it('refuses a valid reporter account with a clear reason', () => {
    const result = staffLoginResult(account(['reporter']));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the reporter to be refused');
    expect(result.error).toBe(NOT_STAFF_MESSAGE);
    expect(result.error).toMatch(/not staff/i);
  });

  it('refuses a reporter who also holds only non-staff roles', () => {
    expect(staffLoginResult(account(['reporter'])).ok).toBe(false);
  });

  it('admits each staff role and lands on the workspace', () => {
    for (const role of STAFF_ROLES) {
      const result = staffLoginResult(account([role]));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected ${role} to be admitted`);
      expect(result.landing).toBe(STAFF_LANDING);
      expect(result.landing).toMatch(/^#\/workspace\//);
    }
  });

  it('never sends a refused account to the workspace', () => {
    const result = staffLoginResult(account(['reporter']));
    expect(result.ok).toBe(false);
    expect('landing' in result).toBe(false);
  });
});

describe('canRenderWorkspace', () => {
  it('allows staff', () => {
    expect(canRenderWorkspace(account(['admin']))).toBe(true);
    expect(canRenderWorkspace(account(['reviewer']))).toBe(true);
    expect(canRenderWorkspace(account(['responder']))).toBe(true);
    expect(canRenderWorkspace(account(['publisher']))).toBe(true);
  });

  it('blocks a reporter, so a hand-typed #/workspace URL cannot render the staff shell', () => {
    expect(canRenderWorkspace(account(['reporter']))).toBe(false);
  });

  it('blocks a signed-out visitor', () => {
    expect(canRenderWorkspace(null)).toBe(false);
    expect(canRenderWorkspace(undefined)).toBe(false);
  });
});

describe('isStaffUser', () => {
  it('is false without a user', () => {
    expect(isStaffUser(null)).toBe(false);
  });

  it('matches the gate for the same account', () => {
    const reporter = account(['reporter']);
    expect(isStaffUser(reporter)).toBe(canRenderWorkspace(reporter));
  });
});

const WORKSPACE_NAV:NavItem[] = [
  ['dashboard', 'grid', 'Overview'],
  ['reports', 'file', 'Reports'],
  ['verify', 'check', 'Verification'],
  ['team', 'settings', 'Team & settings'],
];

describe('canRenderWorkspacePage', () => {
  it('admits an administrator to the admin overview', () => {
    for (const page of ADMIN_ONLY_PAGES) {
      expect(canRenderWorkspacePage(account(['admin']), page)).toBe(true);
    }
  });

  it('refuses a non-admin staff member the admin overview', () => {
    // The backend 403s this too, but the point is the reviewer never loads a page
    // whose every panel would fail.
    expect(canRenderWorkspacePage(account(['reviewer']), 'admin')).toBe(false);
    expect(canRenderWorkspacePage(account(['publisher']), 'admin')).toBe(false);
    expect(canRenderWorkspacePage(account(['responder']), 'admin')).toBe(false);
  });

  it('still admits a non-admin staff member to ordinary workspace pages', () => {
    for (const [page] of WORKSPACE_NAV) {
      expect(canRenderWorkspacePage(account(['reviewer']), page)).toBe(true);
    }
  });

  it('refuses a reporter every workspace page, including the admin overview', () => {
    for (const [page] of [...WORKSPACE_NAV, ['admin', 'lock', 'Admin']]) {
      expect(canRenderWorkspacePage(account(['reporter']), page)).toBe(false);
    }
  });

  it('refuses a signed-out visitor', () => {
    expect(canRenderWorkspacePage(null, 'admin')).toBe(false);
    expect(canRenderWorkspacePage(null, 'dashboard')).toBe(false);
  });

  it('an admin holding reviewer too is still admitted', () => {
    expect(canRenderWorkspacePage(account(['admin', 'reviewer']), 'admin')).toBe(true);
  });
});

describe('withAdminNav', () => {
  it('adds the admin entry for an administrator', () => {
    const items = withAdminNav(WORKSPACE_NAV, account(['admin']));
    expect(items).toHaveLength(WORKSPACE_NAV.length + 1);
    expect(items[items.length - 1][0]).toBe('admin');
  });

  it('never offers the admin entry to a reviewer', () => {
    for (const role of ['reviewer', 'responder', 'publisher'] as const) {
      expect(withAdminNav(WORKSPACE_NAV, account([role])).map(i => i[0])).not.toContain('admin');
    }
  });

  it('does not add it for a reporter or a signed-out visitor', () => {
    expect(withAdminNav(WORKSPACE_NAV, account(['reporter']))).toHaveLength(WORKSPACE_NAV.length);
    expect(withAdminNav(WORKSPACE_NAV, null)).toHaveLength(WORKSPACE_NAV.length);
    expect(withAdminNav(WORKSPACE_NAV, null)).toEqual(WORKSPACE_NAV);
  });

  it('does not mutate the module-level navigation array', () => {
    // A shared const array mutated in place would leak an admin link into every session.
    const before = WORKSPACE_NAV.length;
    withAdminNav(WORKSPACE_NAV, account(['admin']));
    expect(WORKSPACE_NAV).toHaveLength(before);
    expect(WORKSPACE_NAV.map(i => i[0])).not.toContain('admin');
  });

  it('is idempotent, so a second call cannot duplicate the admin entry', () => {
    const once = withAdminNav(WORKSPACE_NAV, account(['admin']));
    const twice = withAdminNav(once, account(['admin']));
    expect(twice.filter(i => i[0] === 'admin')).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it('removes an admin entry a reviewer can no longer reach', () => {
    // The nav is rebuilt on every render from the live roles, so losing the admin role
    // must withdraw the link rather than leave a dead one behind.
    const asAdmin = withAdminNav(WORKSPACE_NAV, account(['admin']));
    expect(withAdminNav(asAdmin, account(['reviewer'])).map(i => i[0])).not.toContain('admin');
  });
});
