import React from 'react';
import {useData} from '../lib/useData';
import {useApp} from '../lib/context';
import {PageHead,Card,Notice,Loading,ErrorBox,Button,Icon} from '../components/ui';

export function Stakeholders(){
  const{nav}=useApp();
  const d=useData<{items:{name:string;role:string;workspace:string}[];note:string}>('/stakeholders');
  if(d.loading&&!d.data)return <Loading/>;
  if(d.error)return <ErrorBox message={d.error} retry={d.reload}/>;
  return <><PageHead label="WHO IS INVOLVED" title="People and organisations in the proposed pilot." subtitle="Roles describe intended participation, not confirmed agreements."/>
    <div className="grid2">{d.data?.items.map(s=><Card key={s.name}><div className="row"><span className="iconbox"><Icon name="user" size={20}/></span><div><h3>{s.name}</h3><small>{s.workspace}</small></div></div><p style={{marginTop:11}}>{s.role}</p></Card>)}</div>
    {d.data?.note&&<Notice tone="blue">{d.data.note}</Notice>}
    <Button variant="ghost" icon="back" onClick={()=>nav('help')}>Back to help and safety</Button>
  </>;
}
