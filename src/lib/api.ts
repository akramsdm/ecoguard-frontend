import type {User, OsmArea, OsmAreaDetail, AreaCoverage, MyArea} from './types';
let csrf='';
const BASE=(import.meta.env.VITE_API_BASE_URL||'/api/v1').replace(/\/$/,'');
export class ApiError extends Error{constructor(message:string,public status:number){super(message);this.name='ApiError'}}
export const setCsrf=(token:string)=>{csrf=token};
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{const method=(init.method||'GET').toUpperCase();const headers=new Headers(init.headers);if(init.body&&!(init.body instanceof FormData))headers.set('Content-Type','application/json');if(!['GET','HEAD','OPTIONS'].includes(method)&&csrf)headers.set('X-CSRF-Token',csrf);let r:Response;try{r=await fetch(BASE+path,{...init,headers,credentials:'include',cache:'no-store'})}catch{throw new ApiError('Cannot reach EcoGuard API. Check that the backend is running.',0)}if(r.status===204)return undefined as T;const json=await r.json().catch(()=>({detail:'Unexpected API response.'}));if(!r.ok){const d=Array.isArray(json.detail)?json.detail.map((x:{loc:string[];msg:string})=>`${x.loc.slice(1).join('.')}: ${x.msg}`).join(' • '):json.detail;if(r.status===401)window.dispatchEvent(new Event('session-expired'));throw new ApiError(typeof d==='string'?d:'Request failed.',r.status)}return json as T}
export const post=<T,>(path:string,body:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export async function signIn(email:string,password:string,name?:string){const result=await post<{user:User;csrf_token:string}>(name?'/auth/register':'/auth/login',name?{email,password,name}:{email,password});setCsrf(result.csrf_token);return result.user}
export async function downloadExport(){const r=await fetch(BASE+'/reports/export.csv',{credentials:'include'});if(!r.ok)throw new ApiError('Export unavailable.',r.status);const b=await r.blob();const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='ecoguard-reports.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),3000)}
/** Browse OSM-backed geographic areas with optional search/filter/pagination. */
export function areasOsm(params:Record<string,string|number|boolean|undefined>={}){
  const query=new URLSearchParams();
  Object.entries(params).forEach(([key,value])=>{
    if(value!==undefined&&value!=='')query.set(key,String(value));
  });
  const qs=query.toString();
  return api<{items:OsmArea[];total:number;limit:number;offset:number;attribution:string}>(`/areas-osm${qs?'?'+qs:''}`);
}
export const osmArea=(id:number)=>api<OsmAreaDetail>(`/areas-osm/${id}`);
export const setAreaActive=(id:number,active:boolean)=>api<{id:number;active:boolean}>(`/admin/areas-osm/${id}`,{method:'PATCH',body:JSON.stringify({active})});
export const areaCoverage=()=>api<AreaCoverage>('/admin/areas-osm/coverage');
export const myAreas=()=>api<{items:MyArea[]}>('/my-areas');
