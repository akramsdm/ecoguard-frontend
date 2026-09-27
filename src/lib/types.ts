export type Role='reporter'|'reviewer'|'publisher'|'responder'|'admin';
export type Category='wildlife'|'wetland'|'flood';
export interface Preferences {name?:string; followed_areas:string[]; in_app:boolean; phone?:string; sms_opt_in:boolean; language:'en'}
export interface User {id:string; name:string; email:string; roles:Role[]; areas:string[]; active:boolean; preferences:Preferences}
export interface Area {id:string; name:string; description:string; latitude:number; longitude:number; radius_km:number}
export interface Evidence {id:string; url:string; filename:string; width:number; height:number}
export interface CaseEvent {id:string; action:string; note:string; created_at:string}
export interface CaseReport {id:string;code:string;client_id:string;category:Category;title:string;description:string;species:string;area_id:string;area_name:string;observed_at:string;latitude:number|null;longitude:number|null;share_location:boolean;consent:boolean;state:string;version:number;assignee_id:string|null;created_at:string;updated_at:string;is_owner:boolean;evidence:Evidence[];timeline?:CaseEvent[];reviews?:{id:string;decision:string;notes:string;species:string;created_at:string}[]}
export interface Advisory {id:string; report_id?:string; version?:number; area_id:string; area_name:string; category:Category;title:string;body:string;source:string;state:string;expires_at:string;published_at:string|null;created_at:string;retraction_reason?:string;read?:boolean;latitude:number;longitude:number}
export interface Prediction {id:string;state:string;species:string|null;confidence:number|null;boxes:unknown[];model_version:string;explanation:string}
export interface Message {id:string;body:string;is_mine:boolean;sender_label:string;created_at:string}
export interface Config {demo_enabled:boolean;image_assistance:'ready'|'degraded'|'not_configured';sms:string;max_upload_mb:number;languages:string[]}
export interface Dashboard {counts:Record<string,number>;states:Record<string,number>;categories:Record<string,number>;activity:{date:string;count:number}[];recent:CaseReport[];scope:string;note:string;ai_metrics:null}
export interface Collection<T> {items:T[];total?:number;page?:number;page_size?:number}
export interface GeoFeature {id:string;type:'Feature';geometry:{type:'Point';coordinates:[number,number]};properties:{id:string;title:string;category:Category;state:string;area_name:string;precision:string;kind:string}}
export interface GeoData {type:'FeatureCollection';features:GeoFeature[];location_policy:string}
export interface Draft {owner:string; client_id:string; category:Category;title:string;description:string;species:string;area_id:string;observed_at:string;latitude:string;longitude:string;share_location:boolean;consent:boolean;image?:Blob; image_name?:string;evidence?:Evidence; prediction?:Prediction;server_id?:string;server_version?:number;submitted?:boolean}
