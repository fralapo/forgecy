/** Pure Instagram calculations: no inferred/synthetic metrics and no cross-account mixing. */
export type ObservedMedia={
 id:string;caption?:string;permalink?:string;media_type?:string;timestamp?:string;
 like_count?:number|null;comments_count?:number|null;
 insights?:Record<string,number|null>
};
export type ObservedSnapshot={
 id:string;account_id?:string;collected_at:string;period:string;
 data:{account?:{username?:string;followers_count?:number|null;media_count?:number|null};
   media?:ObservedMedia[];account_insights?:Record<string,number|null>;
   metric_precision?:Record<string,"exact"|"rounded">;
   source?:string;measured?:boolean;insights_status?:string}
};
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
export function summarizeInstagram(snapshots:ObservedSnapshot[], accountId?:string|null){
 const relevant=(accountId?snapshots.filter(s=>s.account_id===accountId):snapshots)
   .filter(s=>s.data?.measured===true)
   .sort((a,b)=>Date.parse(b.collected_at)-Date.parse(a.collected_at));
 const latest=relevant[0];
 const matching=latest
   ?relevant.filter(s=>s.account_id===latest.account_id)
   :[];
 const previous=matching.find(s=>s.id!==latest?.id&&finite(s.data.account?.followers_count));
 const currentFollowers=latest?.data.account?.followers_count;
 const beforeFollowers=previous?.data.account?.followers_count;
 const delta=finite(currentFollowers)&&finite(beforeFollowers)?currentFollowers-beforeFollowers:null;
 const deltaApproximate=latest?.data.metric_precision?.followers_count==="rounded"||previous?.data.metric_precision?.followers_count==="rounded";
 const media=latest?.data.media||[];
 const postStats=media.map(m=>{
   const likes=finite(m.like_count)?m.like_count:null;
   const comments=finite(m.comments_count)?m.comments_count:null;
   return {...m,likes,comments,interactions:likes!==null&&comments!==null?likes+comments:null,
     reach:finite(m.insights?.reach)?m.insights!.reach!:null,
     saves:finite(m.insights?.saved)?m.insights!.saved!:null,
     shares:finite(m.insights?.shares)?m.insights!.shares!:null};
 });
 const withInteractions=postStats.filter(p=>p.interactions!==null);
 const totalInteractions=withInteractions.length
   ?withInteractions.reduce((acc,p)=>acc+(p.interactions??0),0):null;
 const avgInteractions=totalInteractions===null?null:totalInteractions/withInteractions.length;
 const top=withInteractions.slice().sort((a,b)=>(b.interactions??0)-(a.interactions??0)).slice(0,8);
 const allWithReach=postStats.filter(p=>p.reach!==null);
 const reached=allWithReach.length>0 ? allWithReach.length:null;
 const history=matching.filter(s=>finite(s.data.account?.followers_count)).reverse().slice(-12)
   .map(s=>({date:s.collected_at,count:s.data.account!.followers_count!}));
 return {latest,previous,delta,followers:finite(currentFollowers)?currentFollowers:null,
   media_count:finite(latest?.data.account?.media_count)?latest!.data.account!.media_count!:null,
   sampled_posts:media.length,sampled_posts_with_interactions:withInteractions.length,
   total_sampled_interactions:totalInteractions,average_interactions:avgInteractions,
   sampled_posts_with_reach:reached,top,posts:postStats,history,delta_approximate:deltaApproximate,
   account_insights:latest?.data.account_insights||{}};
}
