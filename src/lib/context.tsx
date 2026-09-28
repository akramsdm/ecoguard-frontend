import React, {createContext,useContext} from 'react';
import type {User,Area,Config,Draft,Category} from './types';
export interface AppContextType {user:User|null;setUser:(user:User|null)=>void;areas:Area[];config:Config|null;draft:Draft|null;setDraft:(draft:Draft|null)=>void;saveLocal:()=>Promise<void>;startDraft:(category?:Category)=>void;notify:(message:string)=>void;nav:(page:string,mode?:'community'|'workspace',id?:string)=>void;logout:()=>Promise<void>;mode:'community'|'workspace';page:string;id:string;tab:string;refresh:number;changed:()=>void}
export const AppContext=createContext<AppContextType|null>(null);
export function useApp(){const c=useContext(AppContext);if(!c)throw Error('EcoGuard context unavailable');return c;}
