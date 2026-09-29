/** @vitest-environment jsdom */
/**
 * The gated-report intent behind the public landing's "Report" button
 * (src/lib/landing.ts).
 *
 * The landing cannot start a report for a signed-out visitor — drafts are keyed
 * by user id — so it parks the intent, sends the visitor through the existing
 * sign-in flow, and the shell turns the intent into the draft that continues
 * into the existing report entry point. These assertions cover that parking,
 * the one-shot consumption, the location carry-through and the post-auth home.
 */
import {beforeEach,describe,expect,it} from 'vitest';
import {
  authenticatedHome,
  clearReportIntent,
  draftForIntent,
  getReportIntent,
  startReportIntent,
  takeReportIntent,
} from './landing';
import {STAFF_LANDING} from './auth';
import type {Role,User} from './types';

function account(roles:Role[]):User {
  return {id: 'user-1', name: 'Test Account', email: 'a@example.org', roles,
          areas: ['area-a'], active: true,
          preferences: {followed_areas: [], in_app: true, sms_opt_in: false, language: 'en'}};
}

beforeEach(() => clearReportIntent());

describe('report intent', () => {
  it('parks nothing by default', () => {
    expect(getReportIntent()).toBeNull();
  });

  it('parks the category and is consumed exactly once', () => {
    startReportIntent('wetland');
    expect(getReportIntent()).toEqual({category: 'wetland'});
    expect(takeReportIntent()).toEqual({category: 'wetland'});
    expect(takeReportIntent()).toBeNull();
    expect(getReportIntent()).toBeNull();
  });

  it('carries a location chosen on the landing', () => {
    startReportIntent('wildlife', {lat: 1.4823, lon: 32.2559});
    expect(takeReportIntent()).toEqual({category: 'wildlife', location: {lat: 1.4823, lon: 32.2559}});
  });

  it('overwrites an earlier intent rather than stacking them', () => {
    startReportIntent('flood');
    startReportIntent('wildlife', {lat: 0.3, lon: 32.5});
    expect(takeReportIntent()).toEqual({category: 'wildlife', location: {lat: 0.3, lon: 32.5}});
  });

  it('treats an absent or null location as "no location"', () => {
    startReportIntent('wildlife');
    expect(takeReportIntent()).toEqual({category: 'wildlife'});
    startReportIntent('wildlife', null);
    expect(takeReportIntent()).toEqual({category: 'wildlife'});
  });

  it('defaults to a wildlife report when no category is given', () => {
    startReportIntent();
    expect(takeReportIntent()).toEqual({category: 'wildlife'});
  });
});

describe('draftForIntent', () => {
  it('seeds a fresh draft owned by the signed-in account, carrying the location', () => {
    const d = draftForIntent(account(['reporter']), {category: 'wildlife', location: {lat: 1.4823, lon: 32.2559}});
    expect(d.owner).toBe('user-1');
    expect(d.category).toBe('wildlife');
    expect(d.latitude).toBe('1.4823');
    expect(d.longitude).toBe('32.2559');
    expect(d.share_location).toBe(true);
  });

  it('leaves precise-location sharing off when the visitor picked no point', () => {
    const d = draftForIntent(account(['reporter']), {category: 'wetland'});
    expect(d.latitude).toBe('');
    expect(d.longitude).toBe('');
    expect(d.share_location).toBe(false);
  });

  it('starts unsent and unconsented, so the reporter still confirms before sending', () => {
    const d = draftForIntent(account(['reporter']), {category: 'flood'});
    expect(d.consent).toBe(false);
    expect(d.submitted).toBeUndefined();
    expect(d.server_id).toBeUndefined();
  });
});

describe('authenticatedHome', () => {
  it('sends a staff account to the workspace', () => {
    expect(authenticatedHome(account(['reviewer']))).toBe(STAFF_LANDING);
    expect(authenticatedHome(account(['admin']))).toBe(STAFF_LANDING);
  });

  it('sends a reporter — and a signed-out visitor — to community home', () => {
    expect(authenticatedHome(account(['reporter']))).toBe('#/community/home');
    expect(authenticatedHome(null)).toBe('#/community/home');
  });
});
