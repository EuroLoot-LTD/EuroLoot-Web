const {app,BrowserWindow,Menu,session,shell,dialog}=require('electron');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {once}=require('node:events');

let win,db,server,origin,signedIn;
const smoke=process.argv.includes('--euroloot-smoke');
app.setName('EuroLoot Staging');
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(win){win.restore();win.focus();}});
  app.whenReady().then(start).catch(e=>{console.error('Desktop startup failed:',e.message);app.exit(1);});
}
function safeExternal(raw){
  try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&['store.steampowered.com','www.cheapshark.com','github.com'].includes(u.hostname);}catch{return false;}
}
async function start(){
  const root=app.getAppPath();
  const load=file=>import(pathToFileURL(join(root,file)).href);
  const {openDatabase,invite}=await load('scripts/local-db.mjs');
  const {localEnvironment,createLocalServer}=await load('scripts/local.mjs');
  const {dispatch}=await load('server/app.mjs');
  db=openDatabase(join(app.getPath('userData'),'staging','store.sqlite'),true);
  const env=localEnvironment(db);server=createLocalServer(env);server.listen(0,'127.0.0.1');await once(server,'listening');
  origin='http://127.0.0.1:'+server.address().port;
  const ses=session.fromPartition('persist:euroloot-staging');
  ses.setPermissionRequestHandler((_wc,_permission,done)=>done(false));
  ses.setPermissionCheckHandler(()=>false);
  signedIn=async()=>{
    const code=await invite(db,'fixture-desktop');
    const r=await dispatch(new Request(origin+'/api/auth/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code})}),env,{local:true,country:'IE',ip:'desktop'});
    if(!r.ok)throw Error('Local test account could not be opened.');
    const value=r.headers.get('set-cookie').split(';')[0].slice('el_local='.length);
    await ses.cookies.set({url:origin,name:'el_local',value,httpOnly:true,sameSite:'lax',expirationDate:Date.now()/1000+1800});
  };
  await signedIn();
  win=new BrowserWindow({width:1180,height:830,minWidth:720,minHeight:500,show:!smoke,title:'EuroLoot · Local sandbox',icon:join(root,'dist/desktop-icon-512.png'),
    webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,devTools:false}});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();if(safeExternal(url))void shell.openExternal(url);}});
  win.webContents.setWindowOpenHandler(({url})=>{if(safeExternal(url))void shell.openExternal(url);return {action:'deny'};});
  ses.on('will-download',(event,item,contents)=>{
    if(contents!==win?.webContents||!item.getURL().startsWith('blob:'+origin+'/')||item.getTotalBytes()>16*1024*1024||item.getFilename()!=='EuroLoot-verification.txt')event.preventDefault();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'EuroLoot',submenu:[{label:'Open local test account',click:async()=>{await signedIn();await win.loadURL(origin+'/retail/#account');}},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'},{label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
    {label:'Help',submenu:[{label:'Staging information',click:()=>dialog.showMessageBox(win,{message:'EuroLoot local staging',detail:'This installation has its own test account, SQLite database and original download fixture. Test orders do not take payment.'})}]}
  ]));
  await win.loadURL(origin+'/retail/');
  if(smoke){
    const result=await win.webContents.executeJavaScript("fetch('/api/session').then(r=>r.json()).then(s=>({account:s.account?.id,local:s.local,title:document.title,node:typeof require}))");
    if(result.account!=='fixture-desktop'||!result.local||result.node!=='undefined'||!result.title.includes('EuroLoot'))throw Error('Desktop isolation or session check failed.');
    if(process.env.EUROLOOT_SMOKE_RESULT)require('node:fs').writeFileSync(process.env.EUROLOOT_SMOKE_RESULT,'passed');
    console.log('EUROLOOT_DESKTOP_SMOKE_OK');app.quit();
  }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{server?.close();});
app.on('will-quit',()=>{db?.sqlite.close();});
