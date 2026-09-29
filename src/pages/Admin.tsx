/**
 * Administrator overview: account provisioning, area coverage and delivery health.
 *
 * Separate from Team & settings, which remains the place to create and edit individual
 * accounts. This page answers the question an administrator actually opens the product
 * with -- is this deployment configured well enough to use -- and deep links to the
 * Team & settings tab that holds the fix when it is not.
 */
import {useApp} from '../lib/context';
import {useData} from '../lib/useData';
import {Button,Card,Notice,Empty,Loading,ErrorBox,PageHead,Icon,Badge,State,nice} from '../components/ui';
import {canRenderWorkspacePage} from '../lib/auth';
import type {AreaCoverage} from '../lib/types';

type Attention={severity:'high'|'medium'|'low'|'ok';message:string};
type AdminDashboard={
  users:{total:number;active:number;inactive:number;by_role:Record<string,number>;case_staff:number;admins:number};
  areas:{total:number;with_staff:number;without_staff:{id:string;name:string}[]};
  reports:{total:number;by_state:Record<string,number>;by_category:Record<string,number>};
  advisories:{total:number;by_state:Record<string,number>};
  jobs:{total:number;by_state:Record<string,number>;
        failed:{id:string;kind:string;attempts:number;last_error:string|null;created_at:string}[]};
  image_assistance:{state:string;model_version:string;detail:string};
  attention:Attention[];generated_at:string;note:string;
};

const SEVERITY_TONE:Record<Attention['severity'],string>={high:'red',medium:'amber',low:'gray',ok:'green'};

/** Deep link to a Team & settings tab, which owns the per-account and per-area forms. */
function tabLink(page:string,tab:string){return()=>{location.hash=`#/workspace/${page}?tab=${tab}`;};}

export function AdminPage(){
  const {user,nav}=useApp();
  const allowed=canRenderWorkspacePage(user,'admin');
  // The request is only issued when the route is permitted. useData accepts a null path
  // for exactly this reason: the hook is still called, so the render stays hook-stable
  // when an administrator's roles change underneath the open page.
  const d=useData<AdminDashboard>(allowed?'/admin/dashboard':null,20000);
  const cov=useData<AreaCoverage>(allowed?'/admin/areas-osm/coverage':null,20000);

  if(!allowed)return <Empty title="Administrator access required" action={
    <Button onClick={()=>nav('dashboard','workspace')}>Back to overview</Button>}>This page is limited to accounts holding the administrator role.</Empty>;
  if(d.loading&&!d.data)return <Loading/>;
  if(d.error)return <ErrorBox message={d.error} retry={d.reload}/>;
  const data=d.data;
  if(!data)return <Loading/>;

  const tiles:readonly {label:string;value:string;sub:string;icon:string;go:()=>void}[]=[
    {label:'Accounts',value:String(data.users.total),sub:`${data.users.active} active`,icon:'user',go:tabLink('team','team')},
    {label:'Administrators',value:String(data.users.admins),sub:'can grant access',icon:'lock',go:tabLink('team','team')},
    {label:'Areas covered',value:cov.data?`${cov.data.items.filter(i=>i.active&&i.assigned_staff>0).length}/${cov.data.items.filter(i=>i.active).length}`:'-',sub:'active OSM areas with staff',icon:'map',go:tabLink('team','areas')},
    {label:'Failed jobs',value:String(data.jobs.by_state.failed||0),sub:'will not retry',icon:'bell',go:tabLink('team','jobs')},
  ];
  const activeAreas=cov.data?.items.filter(i=>i.active)||[];
  const staffedAreas=activeAreas.filter(i=>i.assigned_staff>0)||[];
  const covRows=cov.data?.items.filter(i=>i.needs_staff||i.open_cases>0).slice(0,8)||[];

  return <>
    <PageHead label="ADMINISTRATION" title="Is this deployment ready to use?"
      subtitle="Account provisioning, area coverage and delivery health, in one place."
      action={<Button variant="ghost" onClick={()=>nav('team','workspace')}>Manage accounts</Button>}/>

    <div className="grid4 stats">
      {tiles.map(t=>
        <button className="stat-link" key={t.label} onClick={t.go} type="button">
          <span className="iconbox"><Icon name={t.icon}/></span>
          <div><strong>{t.value}</strong><small>{t.label} &middot; {t.sub}</small></div>
        </button>)}
    </div>

    <div className="grid2">
      <Card>
        <h3>Needs attention</h3>
        {data.attention.map((a,i)=>
          <div className="row" key={i}>
            <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
            <span className="grow">{a.message}</span>
          </div>)}
        <Notice>Counts describe system state. They are not measures of field impact.</Notice>
      </Card>

      <Card>
        <h3>Accounts by role</h3>
        {Object.keys(data.users.by_role).length===0?<Empty title="No accounts yet"/>:
          Object.entries(data.users.by_role).sort((a,b)=>b[1]-a[1]).map(([role,count])=>
            <div className="row between" key={role}><span>{nice(role)}</span><strong>{count}</strong></div>)}
        <div className="row between"><span>Inactive (cannot sign in)</span><strong>{data.users.inactive}</strong></div>
        <Button onClick={tabLink('team','team')}>Create or assign staff</Button>
      </Card>

      <Card>
        <h3>Area coverage</h3>
        {cov.error?<ErrorBox message={cov.error} retry={cov.reload}/>:cov.data?<>
          <p>{staffedAreas.length} of {activeAreas.length} active OSM areas have assigned staff.</p>
          {covRows.length===0
            ?<p>Every area with open cases has staff assigned.</p>
            :covRows.map(a=>
              <div className="row" key={a.id}><Icon name="map" size={17}/><span className="grow">{a.name}<small>{a.area_type} - {a.open_cases} open / {a.total_cases} total</small></span>
                <Badge tone={a.needs_staff?'amber':'green'}>{a.needs_staff?'no staff':'covered'}</Badge></div>)}
          <small>Open = submitted, under review or needs evidence. Areas are OSM-geographic (district, park, reserve).</small>
          <Button variant="ghost small" onClick={tabLink('team','areas')}>Open area catalogue</Button>
        </>:<Loading/>}
      </Card>

      <Card>
        <h3>Delivery health</h3>
        {Object.keys(data.jobs.by_state).length===0?<p>No background jobs have run yet.</p>:
          Object.entries(data.jobs.by_state).map(([state,count])=>
            <div className="row between" key={state}><State state={state}/><strong>{count}</strong></div>)}
        {data.jobs.failed.length>0&&<>
          <h4>Stopped retrying</h4>
          {data.jobs.failed.slice(0,5).map(j=>
            <div className="row" key={j.id}><Badge tone="red">{j.kind}</Badge>
              <span className="grow small">{j.last_error||'No error recorded.'}</span></div>)}
        </>}
        <Button variant="ghost small" onClick={tabLink('team','jobs')}>All jobs</Button>
      </Card>

      <Card>
        <h3>Reports and advisories</h3>
        {Object.keys(data.reports.by_state).length===0?<p>No reports have been filed.</p>:
          Object.entries(data.reports.by_state).map(([state,count])=>
            <div className="row between" key={state}><State state={state}/><strong>{count}</strong></div>)}
        <div className="row between"><span>Published advisories</span>
          <strong>{data.advisories.by_state.published||0}</strong></div>
        <small>{data.note}</small>
      </Card>

      <Card>
        <h3>Image assistance</h3>
        <State state={data.image_assistance.state}/>
        <dl><dt>Model</dt><dd className="mono">{data.image_assistance.model_version}</dd>
          <dt>Status</dt><dd>{data.image_assistance.detail}</dd></dl>
        <small>A suggestion is never a confirmed identification and never sets a report species.</small>
        <Button variant="ghost small" onClick={tabLink('team','integrations')}>Details</Button>
      </Card>
    </div>
    <div className="muted small">Read at {data.generated_at}. This page is never cached, so it reflects the current state.</div>
  </>;
}
