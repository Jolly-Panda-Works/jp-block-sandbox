/**
 * Test login for a deployed copy without a backend: a bookmark the team drags to the bookmarks bar.
 * Clicked IN THE RASTAAR DASHBOARD TAB (same origin, so the dashboard's CSRF check passes and the dashboard
 * session is used), it asks for a playground token for this game and opens the game with it.
 * No secret is involved: the dashboard mints the token, exactly like the "Copy snippet" in its docs.
 */
export function tokenBookmarklet(gameKey: string, gameUrl: string): string {
  const js = `(async()=>{
const w=window.open('about:blank','_blank');
try{
if(!location.pathname.startsWith('/dashboard')){if(w)w.close();alert('Open the Rastaar dashboard (gameserver.rastar.ir/dashboard), sign in, then click this bookmark there.');return;}
const r=await fetch('/dashboard/api/playground/token',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameKey:${JSON.stringify(gameKey)}})});
const j=await r.json().catch(()=>({}));
const d=j&&j.data&&typeof j.data==='object'?j.data:j;
const t=d&&(d.jwt||d.token||d.accessToken);
if(!r.ok||!t){if(w)w.close();alert('Could not get a token ('+r.status+'): '+((j&&(j.message||j.error))||'are you signed in to the dashboard?'));return;}
const u=new URL(${JSON.stringify(gameUrl)});
u.searchParams.set('jwt',t);
if(d.multiplayerId)u.searchParams.set('room',d.multiplayerId);
if(d.wsUrl)u.searchParams.set('wsUrl',d.wsUrl);
if(w)w.location.href=u.toString();else location.href=u.toString();
}catch(e){if(w)w.close();alert('Token request failed: '+e);}
})()`;
  return `javascript:${encodeURIComponent(js.replace(/\n/g, ''))}`;
}
