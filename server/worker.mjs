import {dispatch} from './app.mjs';
export default {
  fetch(request,env){return dispatch(request,env,{country:request.cf?.country,ip:request.headers.get('CF-Connecting-IP'),local:false});},
  async scheduled(_event,env){
    await env.DB.batch(['sessions','invitations','download_tokens','rate_windows','oauth_flows'].map(table=>env.DB.prepare('DELETE FROM '+table+' WHERE expires<=unixepoch()')));
  }
};
