// Synthetic end-to-end ACP approval check. No Outlook, account or model is contacted.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-attention-desktop-'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (process.platform === 'win32') {
  console.log(
    'Synthetic executable fixture requires POSIX; run Windows live Kiro validation separately.',
  );
  app.quit();
} else {
  const fake = path.join(root, 'synthetic-kiro');
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=q=>process.stdout.write(JSON.stringify(q)+'\\n');
const codex=process.argv.includes('app-server');
rl.on('line',line=>{const q=JSON.parse(line);
if(q.id===1)send({id:1,result:{protocolVersion:1}});
else if(q.id===2)send(codex?{id:2,result:{thread:{id:'synthetic'}}}:{id:2,result:{sessionId:'synthetic',modes:{currentModeId:'deepwork'}}});
else if(q.id===3&&codex){send({method:'item/agentMessage/delta',params:{itemId:'answer',delta:'Synthetic Codex output'}});setTimeout(()=>send({method:'turn/completed',params:{turn:{status:'completed'}}}),6000);}
else if(q.id===3){send({method:'session/update',params:{sessionId:'synthetic',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Waiting for your decision.'}}}});
send({id:101,method:'session/request_permission',params:{sessionId:'synthetic',toolCall:{toolCallId:'read',title:'Read synthetic configuration',rawInput:{path:'synthetic.txt'}},options:[{optionId:'yes',name:'Approve once',kind:'allow_once'},{optionId:'no',name:'Deny',kind:'reject_once'}]}});}
else if(q.id===101){send({method:'session/update',params:{sessionId:'synthetic',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:' Decision received: '+q.result.outcome.optionId}}}});send({id:3,result:{stopReason:'end_turn'}});}});
`,
    { mode: 0o700 },
  );
  process.env.DEEPWORK_WORKSPACE = root;
  require('./dist-electron/main.js');
  (async () => {
    await app.whenReady();
    let window;
    for (let i = 0; i < 100; i++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window?.webContents.getURL() && !window.webContents.isLoading()) break;
      await wait(100);
    }
    const js = (code) => window.webContents.executeJavaScript(code);
    const poll = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await js(code)) return;
        await wait(100);
      }
      throw new Error('Timed out: ' + code);
    };
    await poll(`!!document.querySelector('.console-toggle')`);
    if (await js(`!!document.querySelector('.console-body')`))
      throw new Error('Idle console should start collapsed');
    await js(`document.querySelector('.console-toggle').click()`);
    if (
      !(await js(
        `document.querySelector('.console-body')?.textContent.includes('No active CLI session')`,
      ))
    )
      throw new Error('Manual idle console did not open');
    await js(`document.querySelector('.console-toggle').click()`);
    await js(
      `(async()=>{const s=await window.workAPI.request('snapshot');await window.workAPI.request('settings',{...s.settings,provider:'kiro',executable:${JSON.stringify(fake)},execution:'native',organizationApproved:true});const task=await window.workAPI.request('addTask',{title:'Synthetic approval task'});await window.workAPI.request('chat',{taskId:task.id,userContext:'Show approval'});})()`,
    );
    await poll(
      `document.querySelector('.permission-card h3')?.textContent==='Read synthetic configuration'`,
    );
    await poll(
      `document.querySelector('.console-output')?.textContent.includes('Kiro needs your attention')`,
    );
    const before = await js(`window.workAPI.request('snapshot')`);
    const job = before.jobs.find((j) => j.status === 'awaiting_approval');
    if (!job || before.sessions[0].requests.length !== 1) throw new Error('Approval was not live');
    const request = before.sessions[0].requests[0];
    await js(`document.querySelector('.console-toggle').click()`);
    if (await js(`!!document.querySelector('.console-body')`))
      throw new Error('Panel did not collapse');
    if (
      (await js(`window.workAPI.request('snapshot')`)).jobs.find((j) => j.id === job.id).status !==
      'awaiting_approval'
    )
      throw new Error('Hiding panel cancelled session');
    await js(`document.querySelector('.console-toggle').click()`);
    await js(`window.workAPI.request('theme','light')`);
    await wait(2200);
    fs.writeFileSync(
      path.join(os.tmpdir(), 'deepwork-approval-light.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    await js(
      `[...document.querySelectorAll('.permission-card button')].find(b=>b.textContent==='Deny').click()`,
    );
    await poll(
      `window.workAPI.request('snapshot').then(s=>s.jobs.some(j=>j.id===${JSON.stringify(job.id)}&&j.status==='succeeded'))`,
    );
    const stale = await js(
      `window.workAPI.request('permission',{jobId:${JSON.stringify(job.id)},requestId:${JSON.stringify(request.requestId)},optionId:'yes'}).then(()=>false,()=>true)`,
    );
    if (!stale) throw new Error('Stale approval accepted');
    await js(
      `(async()=>{const s=await window.workAPI.request('snapshot');await window.workAPI.request('settings',{...s.settings,provider:'codex',executable:${JSON.stringify(fake)}});const task=await window.workAPI.request('addTask',{title:'Synthetic Codex task'});await window.workAPI.request('chat',{taskId:task.id,userContext:'Show output'});})()`,
    );
    await poll(`document.querySelector('.console-toggle')?.textContent.includes('Codex console')`);
    await poll(
      `document.querySelector('.console-body')?.textContent.includes('Synthetic Codex output')`,
    );
    const codexSnapshot = await js(`window.workAPI.request('snapshot')`);
    const codexSession = codexSnapshot.sessions.find((s) => s.provider === 'codex');
    if (!codexSession) throw new Error('Codex session provider not preserved');
    await js(
      `(async()=>{const s=await window.workAPI.request('snapshot');await window.workAPI.request('settings',{...s.settings,provider:'kiro'});})()`,
    );
    await poll(`document.querySelector('.console-toggle')?.textContent.includes('Kiro console')`);
    if (
      !(await js(`document.querySelector('.console-body')?.textContent.includes('Codex · chat')`))
    )
      throw new Error('Settings change relabeled active Codex session');
    await js(`window.workAPI.request('cancel',${JSON.stringify(codexSession.jobId)})`);
    console.log(
      'PASS: manual idle console open/close, live worker ACP approval, auto-expand, collapse, deny/resume, stale decision rejection, light theme, Codex output, provider switching.',
    );
    app.quit();
  })().catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
}
