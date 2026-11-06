import React, {useEffect, useState} from 'react';
import {getReportPredictions, ReportPredictions} from '../lib/api';

export function AiSuggestionPanel({reportId}:{reportId:string}){
  const [data, setData] = useState<ReportPredictions|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    getReportPredictions(reportId).then(d=>{if(!cancelled){setData(d);setError(null);} }).catch(e=>{if(!cancelled) setError(String(e?.message||e));}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[reportId]);
  let body: React.ReactNode = null;
  if (loading) body = <p>Loading...</p>;
  else if (error) body = <p className="error">{error}</p>;
  else if (data && data.summary.best_species) body = (
    <>
      <p>{data.summary.best_species} • {Math.round((data.summary.best_confidence||0)*100)}% • {data.summary.priority||'none'}</p>
      <p>AI suggestions can be wrong. You make the final decision.</p>
    </>
  );
  else body = <p>Analysis in progress or not available</p>;
  return <div className="card"><h3>AI suggestion</h3>{body}</div>;
}
"""