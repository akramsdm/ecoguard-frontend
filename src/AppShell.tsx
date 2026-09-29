import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppContext} from './lib/context';
import type {AppContextType} from './lib/context';
import {useRealtimeEvents} from './lib/useRealtime';
import type {RealtimeEvent} from './lib/useRealtime';
import {api,post,setCsrf} from './lib/api';
import {loadDraft,removeDraft,saveDraft,newDraft} from './lib/drafts';
import type {Area,Category,Config,Draft,User} from './lib/types';
import {Button,Icon,Brand,Empty} from './components/ui';
import {Welcome,SignIn,Home,Upload,Identify,ReportForm,ReviewSubmit,Success,Alerts,AlertDetail,MyReports,Progress,CommunityMap,Messages,Profile,Help} from './pages/Community';
import {Nearby} from './pages/Nearby';
import {DashboardPage,ReportWorkspace,Verification,MapWorkspace,AlertCentre,Analytics,TeamSettings} from './pages/Workspace';
import {StaffLogin} from './pages/Staff';
import {AdminPage} from './pages/Admin';
import {canRenderWorkspace, canRenderWorkspacePage, isStaffUser, withAdminNav, STAFF_LANDING} from './lib/auth';
import {takeReportIntent, draftForIntent, authenticatedHome} from './lib/landing';
import {PublicLanding} from './pages/Landing';
import {Stakeholders} from './pages/Stakeholders';
import {Screens} from './pages/Screens';
import './styles.css';
import './app.css';

type Mode='community'|'workspace';
type Route={mode:Mode;page:string;id:string;tab:string;staffGate:boolean};
/**
 * Pages reachable with no account. 'home' is the public landing (the live map);
 * the rest keep their existing sign-in-gated behaviour.
 */
const PUBLIC_PAGES=['home','welcome','signin','help','nearby'];

/** #/staff/login is its own entry point, not a flag on the community login. */
function readRoute():Route{
  const[path,query='']=location.hash.replace(/^#\/?/,'').split('?');
  const[head,page]=path.split('/');
  const q=new URLSearchParams(query);
  const id=q.get('id')||'',tab=q.get('tab')||'';
  if(head==='staff')return {mode:'community',page:page||'login',id,tab,staffGate:true};
  return {mode:head==='workspace'?'workspace':'community',page:page||'home',id,tab,staffGate:false};
}

const COMMUNITY_NAV=[['home','home','Home'],['map','map','Map'],['nearby','map','Near me'],['myreports','file','My reports'],['alerts','bell','Advisories'],['profile','user','Profile']] as const;
const WORKSPACE_NAV=[['dashboard','grid','Overview'],['reports','file','Reports'],['wildlife','paw','Wildlife'],['wetland','leaf','Wetlands'],['verify','check','Verification'],['map','map','Incident map'],['alerts','bell','Alert centre'],['analytics','chart','Analytics'],['team','settings','Team & settings']] as const;

export function AppShell(){
  const[route,setRoute]=useState<Route>(readRoute);
  const[user,setUser]=useState<User|null>(null);
  const[booted,setBooted]=useState(false);
  const[areas,setAreas]=useState<Area[]>([]);
  const[config,setConfig]=useState<Config|null>(null);
  const[draft,setDraft]=useState<Draft|null>(null);
  const[refresh,setRefresh]=useState(0);
  const[toast,setToast]=useState('');
  const[realtimeTick,setRealtimeTick]=useState(0);
  const[realtimeEvents,setRealtimeEvents]=useState<RealtimeEvent[]>([]);

  // AppShell owns the realtime auth lifecycle: the single shared EventSource is
  // opened only while a user session exists and closed on logout (the hook shuts
  // the stream down when the last enabled listener disappears). Map screens scope
  // their refetches off realtimeEvents/realtimeTick instead of owning the stream.
  useRealtimeEvents((ev)=>{
    setRealtimeEvents(prev=>[ev,...prev].slice(0,6));
    setRealtimeTick(n=>n+1);
  },!!user);

  useEffect(()=>{const on=()=>setRoute(readRoute());addEventListener('hashchange',on);
    // Root routing: with no hash, wait for /auth/me before choosing a target so
    // a signed-in reporter is never flashed the public landing first. Anonymous
    // visitors go straight to the landing ('#/' and '' both parse to 'home').
    let cancelled=false;
    const resolveRoot=()=>{if(!location.hash&&!cancelled)location.hash='#/community/home';};
    if(location.hash)resolveRoot();
    api<{user:User;csrf_token:string}>('/auth/me').then(x=>{setUser(x.user);setCsrf(x.csrf_token);
      return loadDraft(x.user.id).then(d=>{if(d)setDraft(d)}).catch(()=>{});})
      .catch(()=>{})
      .finally(()=>{if(!cancelled){resolveRoot();setBooted(true);}});
    api<Config>('/config').then(setConfig).catch(()=>{});
    return()=>{cancelled=true;removeEventListener('hashchange',on);};},[]);

  // The community list is cached server-side, so it is refetched whenever a change is
  // reported: a newly created area would otherwise stay invisible until a full reload.
  useEffect(()=>{api<{items:Area[]}>('/areas').then(r=>setAreas(r.items)).catch(()=>{});},[refresh]);

  const nav=useCallback((page:string,mode?:Mode,id='')=>{location.hash=`#/${mode||route.mode}/${page}${id?`?id=${id}`:''}`;},[route.mode]);
  const userRef=useRef<User|null>(null);userRef.current=user;
  useEffect(()=>{const on=()=>{if(userRef.current){setUser(null);setDraft(null);setCsrf('');location.hash='#/community/signin';}};
    addEventListener('session-expired',on);return()=>removeEventListener('session-expired',on);},[]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),3800);return()=>clearTimeout(id);},[toast]);

  const staff=isStaffUser(user);
  // Post-auth routing. A parked "Report" intent (from the public landing) wins:
  // seed the draft — carrying the landing location when set — and go straight to
  // the existing report entry point. Otherwise returning from the sign-in page
  // lands on the account's home. Reads the live hash (not route.page) so React's
  // double-invoked effects cannot undo the first navigation.
  useEffect(()=>{
    if(!user)return;
    const pending=takeReportIntent();
    if(pending){const d=draftForIntent(user,pending);setDraft(d);saveDraft(d).catch(()=>{});location.hash='#/community/upload';return;}
    const h=location.hash;
    if(h.startsWith('#/community/welcome')||h.startsWith('#/community/signin'))location.hash=authenticatedHome(user);
  },[user,route.page]);

  // Client-side staff guard. Only navigation was gated before, so a non-staff user who
  // typed a #/workspace/* URL (or followed a stale link) was served the admin shell with
  // every panel failing its requests. This is a UI fix, not a security boundary: the
  // backend 403s every one of those endpoints on its own.
  useEffect(()=>{
    if(route.mode!=='workspace'||!user||canRenderWorkspace(user))return;
    location.hash='#/community/home';
    setToast('The workspace is for staff accounts. You are signed in as a community reporter.');
  },[route.mode,route.page,user]);

  const notify=useCallback((message:string)=>setToast(message),[]);
  const changed=useCallback(()=>setRefresh(n=>n+1),[]);
  const startDraft=useCallback((category:Category='wildlife')=>{if(user)setDraft(newDraft(user.id,category));},[user]);
  const saveLocal=useCallback(async()=>{if(draft)await saveDraft(draft);},[draft]);
  const logout=useCallback(async()=>{const id=user?.id;try{await post('/auth/logout',{});}finally{setUser(null);setCsrf('');setDraft(null);if(id)await removeDraft(id).catch(()=>{});location.hash='#/community/welcome';}},[]);

  const value=useMemo<AppContextType>(()=>({user,setUser,areas,config,draft,setDraft,saveLocal,startDraft,notify,nav,logout,mode:route.mode,page:route.page,id:route.id,tab:route.tab,refresh,changed,realtimeTick,realtimeEvents}),[user,areas,config,draft,route,refresh,saveLocal,startDraft,notify,nav,logout,realtimeTick,realtimeEvents]);
  const staffGate=route.staffGate&&route.page==='login';
  // Someone already holding a staff session has no use for the staff form.
  useEffect(()=>{if(staffGate&&canRenderWorkspace(user))location.hash=STAFF_LANDING;},[staffGate,user]);
  // The staff page is reachable signed out, so it joins the pages that are "open".
  const open=staffGate||!!user||PUBLIC_PAGES.includes(route.page);
  // A workspace page is never rendered for a non-staff account. The effect above clears
  // the hash, but the check is repeated here so a single render can never paint the
  // staff shell for a reporter, even for the frame before the redirect lands.
  // Admin pages are gated one level further than the rest of the workspace.
  const workspaceBlocked=route.mode==='workspace'&&!!user&&!canRenderWorkspacePage(user,route.page);

  const isLanding=route.mode==='community'&&route.page==='home';
  // The landing slot holds two audiences: signed-in reporters get their Home,
  // everyone else the public landing. Until /auth/me has answered there is no
  // safe choice, so a neutral placeholder blocks the landing→home flash.
  const body=!booted&&isLanding?<div className="landing-boot"><span className="spinner"/>Preparing the map…</div>
    :!open?<SignIn/>
    :staffGate?<StaffLogin/>
    :workspaceBlocked?<Empty title="Staff workspace" action={<Button onClick={()=>{location.hash='#/community/home'}}>Back to community home</Button>}/>
    :isLanding&&!user?<PublicLanding/>
    :route.page==='welcome'?<Welcome/>
    :route.page==='signin'?<SignIn/>
    :route.page==='help'?<Help/>
    :route.mode==='workspace'?workspacePage(route.page)
    :communityPage(route.page);
  const navItems=route.mode==='workspace'&&staff&&!staffGate?withAdminNav(WORKSPACE_NAV,user):COMMUNITY_NAV;

  return <AppContext.Provider value={value}>
    <div className={'shell-app '+(route.mode==='workspace'&&staff?'workspace-mode':'community-mode')}>
      <header className="shell-top">
        <Brand/>
        <nav className="shell-links">{navItems.map(([p,i,label])=><button key={p} className={route.page===p?'active':''} onClick={()=>nav(p,route.mode)}><Icon name={i} size={17}/><span>{label}</span></button>)}</nav>
        <div className="shell-user">
          {staffGate&&<Button variant="ghost small" onClick={()=>{location.hash='#/community/signin'}}>Community sign-in</Button>}
          {user&&route.mode!=='workspace'&&!staffGate&&<span className="shell-cta"><Button icon="paw" onClick={()=>{startDraft('wildlife');nav('upload','community');}}><span className="cta-long">Report wildlife</span><span className="cta-short">Report</span></Button></span>}
          {user&&<><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><span className="small">{user.name}</span></>}
          {staff&&!staffGate&&<Button variant="ghost small" onClick={()=>nav('home','community')}>Community view</Button>}
          {user?<Button variant="ghost small" icon="logout" onClick={logout}>Sign out</Button>:!staffGate&&<Button onClick={()=>nav('signin')}>Sign in</Button>}
        </div>
      </header>
      <div className="shell-body">
        {route.mode==='workspace'&&staff&&<aside className="shell-side"><div className="eyebrow">Pilot workspace</div>{WORKSPACE_NAV.map(([p,i,label])=><button key={p} className={'sideitem '+(route.page===p?'active':'')} onClick={()=>nav(p,'workspace')}><Icon name={i} size={18}/><span>{label}</span></button>)}</aside>}
        <main className="shell-main">{body}</main>
      </div>
      {route.mode!=='workspace'&&user&&<nav className="shell-bottom">{COMMUNITY_NAV.map(([p,i,label])=><button key={p} className={route.page===p?'active':''} onClick={()=>nav(p,'community')}><Icon name={i} size={20}/><span>{label}</span></button>)}</nav>}
      {route.mode!=='workspace'&&user&&<button className="shell-fab" onClick={()=>{startDraft('wildlife');nav('upload','community');}}><Icon name="paw" size={22}/><span>Report</span></button>}
      {toast&&<div className="toast" role="status">{toast}</div>}
    </div>
  </AppContext.Provider>;
}

function communityPage(page:string){
  switch(page){
    case 'home':return <Home/>;
    case 'upload':return <Upload/>;
    case 'identify':return <Identify/>;
    case 'wildlife':return <ReportForm category="wildlife"/>;
    case 'wetland':return <ReportForm category="wetland"/>;
    case 'flood':case 'floodreport':return <ReportForm category="flood"/>;
    case 'review':return <ReviewSubmit/>;
    case 'success':return <Success/>;
    case 'myreports':return <MyReports/>;
    case 'detail':return <Progress/>;
    case 'alerts':return <Alerts/>;
    case 'alertdetail':return <AlertDetail/>;
    case 'map':return <CommunityMap/>;
    case 'nearby':return <Nearby/>;
    case 'community':return <Messages/>;
    case 'profile':return <Profile/>;
    case 'stakeholders':return <Stakeholders/>;
    case 'screens':return <Screens/>;
    default:return <Empty title="Page not found" action={<Button onClick={()=>{location.hash='#/community/home'}}>Return home</Button>}/>;
  }
}

function workspacePage(page:string){
  switch(page){
    case 'dashboard':return <DashboardPage/>;
    case 'admin':return <AdminPage/>;
    case 'reports':return <ReportWorkspace/>;
    case 'wildlife':return <ReportWorkspace category="wildlife" wildlifeGallery/>;
    case 'wetland':return <ReportWorkspace category="wetland"/>;
    case 'flood':return <ReportWorkspace category="flood"/>;
    case 'verify':return <Verification/>;
    case 'map':return <MapWorkspace/>;
    case 'alerts':return <AlertCentre/>;
    case 'analytics':return <Analytics/>;
    case 'team':return <TeamSettings/>;
    default:return <Empty title="Workspace page not found" action={<Button onClick={()=>{location.hash='#/workspace/dashboard'}}>Back to overview</Button>}/>;
  }
}

export default AppShell;
