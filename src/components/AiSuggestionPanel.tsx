import React, {useEffect, useState} from 'react';
import {getReportPredictions, ReportPredictions} from '../lib/api';

function stateMessage(state: string | null): string {
  if (state === 'pending' || state === 'queued') return 'Analysis in progress';
  if (state === 'failed') return 'Analysis failed, review manually';
  if (state === 'unavailable') return 'AI unavailable, review manually';
  return 'No animal detected';
}

export function AiSuggestionPanel({reportId, onUseSpecies}:{reportId:string; onUseSpecies?:(species:string)=>void}){
  const [data, setData] = useState<ReportPredictions|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false;
    let timer:any;
    const fetch = () => {
      setLoading(true);
      getReportPredictions(reportId).then(d=>{if(!cancelled){setData(d);setError(null); const pending=d.items.some(i=>i.state==='pending'||i.state==='queued'); if(pending){ timer=setTimeout(fetch,5000);} } }).catch(e=>{if(!cancelled) setError(String(e?.message||e));}).finally(()=>{if(!cancelled)setLoading(false);});
    };
    fetch();
    return ()=>{cancelled=true; if(timer) clearTimeout(timer);};
  },[reportId]);
  let body: React.ReactNode = null;
  if (loading) body = <p>Loading...</p>;
  else if (error) body = <p className="error">{error}</p>;
  else if (data && data.summary.best_species) body = (
    <>
      <p>{data.summary.best_species} • {Math.round((data.summary.best_confidence||0)*100)}% • {data.summary.priority||'none'}</p>
      {data.summary.species_mismatch && <p className="notice">Reporter said X, AI suggests {data.summary.best_species}</p>}
      <ul>
        {data.items.map((it, i) => (
          <li key={i}>
            <img src="" alt="thumb" width={40} height={40} />
            {it.species || stateMessage(it.state)} • {it.confidence != null ? Math.round(it.confidence*100)+'%' : ''}
            {it.species == null && <span> — {stateMessage(it.state)}</span>}
          </li>
        ))}
      </ul>
      <p>AI suggestions can be wrong. You make the final decision.</p>
      {data.summary.best_species && onUseSpecies && <button onClick={()=>onUseSpecies(data.summary.best_species!)}>Use AI species</button>}
    </>
  );
  else body = <p>Analysis in progress or not available</p>;
  return <div className="card"><h3>AI suggestion</h3>{body}</div>;
}