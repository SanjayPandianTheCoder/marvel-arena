export const hash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
export const rnd=(a,b)=>a+Math.random()*(b-a);
export const pick=a=>a[Math.floor(Math.random()*a.length)];
export const shuf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
export const avg=s=>Math.round(s.reduce((a,b)=>a+b,0)/s.length);
