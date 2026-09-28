import React, {useState} from 'react';
import type {FormEvent} from 'react';
import {useApp} from '../lib/context';
import {post, signIn} from '../lib/api';
import {NOT_STAFF_MESSAGE, staffLoginResult} from '../lib/auth';
import {Button, ErrorBox, Field, Notice, PageHead, Icon} from '../components/ui';

/**
 * The staff entry point, reached at #/staff/login.
 *
 * This is a separate page and a separate route, not the community SignIn component
 * behind a flag. Two things follow from that separation:
 *
 *  - Accounts cannot be created here. Staff access is granted by an administrator, so
 *    the "Create account" tab that the public form offers has no equivalent.
 *  - A successful sign-in whose account holds no staff role is refused here, with an
 *    explicit reason, and the session the server just opened is closed again so a
 *    rejected attempt does not quietly leave the reporter signed in.
 *
 * The session itself is the ordinary EcoGuard session cookie; this page is an additional
 * role gate, not a second credential store. See the PR description for the reasoning.
 */
export function StaffLogin() {
  const {notify} = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const account = await signIn(email, password);
      const result = staffLoginResult(account);
      if (!result.ok) {
        // Credentials were valid, so the server has already issued a session. Drop it:
        // a refused staff attempt must not leave a reporter authenticated.
        await post('/auth/logout', {}).catch(() => undefined);
        setPassword('');
        setError(result.error);
        return;
      }
      notify('Signed in to the staff workspace.');
      location.hash = result.landing;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="staff-gate">
    <PageHead label="STAFF ACCESS" title="EcoGuard staff sign-in"
              subtitle="For reviewers, responders, publishers and administrators."/>
    <form className="stack" onSubmit={submit}>
      <Field label="Work email address">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
               required autoComplete="username" placeholder="name@ecoguard.ug"/>
      </Field>
      <Field label="Password" hint="Use the password set by you or your administrator.">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
               required minLength={1} autoComplete="current-password"/>
      </Field>
      {error && <ErrorBox message={error}/>}
      <Button type="submit" disabled={busy} variant="wide" icon="lock">
        {busy ? 'Checking access…' : 'Sign in to the workspace'}
      </Button>
    </form>
    <Notice tone="amber">
      <Icon name="lock" size={16}/>
      Staff accounts are created and assigned by an administrator. If you are reporting
      wildlife, flooding or wetland change, use the community sign-in instead.
    </Notice>
    <p className="staff-gate-alt">
      Not staff? <a href="#/community/signin">Go to the community sign-in</a>.
    </p>
    <small>Account recovery is administrator-assisted in this release; no recovery email is sent.</small>
  </div>;
}

export const STAFF_LOGIN_HINT = NOT_STAFF_MESSAGE;
