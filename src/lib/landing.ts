/**
 * Gated-report intent for the public landing page.
 *
 * Pressing "Report" while signed out cannot start a draft (drafts are keyed by
 * user id), so the intent is parked here, the visitor goes through the existing
 * sign-in flow, and the shell picks the intent up once `user` is set: it seeds a
 * fresh draft — carrying a location chosen on the landing when there is one —
 * and navigates to the existing report entry point. Session-scoped memory, not
 * storage: a stale intent from a previous visit must never pre-fill a report.
 *
 * Kept out of the component so the shell logic stays a pure function of
 * (user, route) and the intent is testable without mounting the app.
 */
import type {Category, Draft, User} from './types';
import {newDraft} from './drafts';
import {STAFF_LANDING, isStaffUser} from './auth';

export type ReportIntent={category:Category; location?:{lat:number;lon:number}};

let intent:ReportIntent|null=null;

/** Park "start a report" for after sign-in. Overwrites any earlier intent. */
export function startReportIntent(category:Category='wildlife', location?:{lat:number;lon:number}|null):void{
  intent={category,...(location?{location}:{})};
}

export function getReportIntent():ReportIntent|null{return intent;}

/** Read and clear, so the intent fires exactly once after a sign-in. */
export function takeReportIntent():ReportIntent|null{const i=intent;intent=null;return i;}

export function clearReportIntent():void{intent=null;}

/**
 * The draft a parked intent turns into. The landing's point is only a
 * *suggestion* for where the sighting happened: it is carried through, and the
 * report form still lets the reporter change or clear it before submitting.
 */
export function draftForIntent(user:User, i:ReportIntent):Draft{
  const d=newDraft(user.id,i.category);
  if(i.location)d.latitude=String(i.location.lat),d.longitude=String(i.location.lon),d.share_location=true;
  return d;
}

/** Where an authenticated account lands: staff → workspace, reporter → home. */
export function authenticatedHome(user:User|null):string{
  return isStaffUser(user)?STAFF_LANDING:'#/community/home';
}
