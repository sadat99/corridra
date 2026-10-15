// Evidence collector: reverse proxy that injects a passive recorder into HTML responses.
// It never alters application payloads other than appending one inline script, and it only
// issues same-origin GET image beacons so tests that assert "no writes" still hold.
// Usage: node proxy.mjs <listenPort> <targetPort> <outFile>
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const [listen, target, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const recorder = `<script>(function(){
var seen=new Set(),queue=[],timer=0;
var SEL='a[href],button,summary,input,select,textarea,[role=button],[role=tab],[role=menuitem]';
function txt(e){return (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,160)}
function fp(el,ev){var f=el.tagName==='FORM'?el:(el.closest&&el.closest('form'));var l=el.labels&&el.labels[0];var w=el.closest&&el.closest('label');var tg=el.tagName;
var flat=(tg==='INPUT'||tg==='SELECT'||tg==='TEXTAREA');
return {ev:ev,path:location.pathname,tag:tg.toLowerCase(),type:el.getAttribute('type')||'',name:el.getAttribute('name')||'',id:el.id||'',aria:el.getAttribute('aria-label')||'',
text:flat?'':txt(el),label:l?txt(l):'',wrap:w?txt(w):'',first:(tg==='SELECT'&&el.options&&el.options[0])?txt(el.options[0]):'',max:el.getAttribute('maxlength')||'',
ph:el.getAttribute('placeholder')||'',href:el.getAttribute('href')||'',role:el.getAttribute('role')||'',formAria:f?(f.getAttribute('aria-label')||''):'',
formText:tg==='FORM'?txt(el).slice(0,100):'',inForm:!!f,names:tg==='FORM'?Array.prototype.map.call(el.elements||[],function(x){return x.name||''}).filter(Boolean).join(','):''}}
function flush(){timer=0;while(queue.length){var batch=[],size=0;while(queue.length&&size<5000){var s=queue.shift();batch.push(s);size+=s.length}
try{var i=new Image();i.src='/__cov?d='+encodeURIComponent('['+batch.join(',')+']')}catch(e){}}}
function send(o){var k=JSON.stringify(o);if(seen.has(k))return;seen.add(k);queue.push(k);if(!timer)timer=setTimeout(flush,350)}
function target(e){var t=e.target;if(!t||!t.closest)return null;return t.closest(SEL)}
document.addEventListener('click',function(e){var t=target(e);if(t)send(fp(t,'click'))},true);
document.addEventListener('submit',function(e){if(e.target&&e.target.tagName==='FORM'){var o=fp(e.target,'submit');o.sub=e.submitter?txt(e.submitter):'';send(o)}},true);
document.addEventListener('change',function(e){var t=target(e);if(t)send(fp(t,'change'))},true);
document.addEventListener('input',function(e){var t=target(e);if(t)send(fp(t,'input'))},true);
function census(){var all=document.querySelectorAll(SEL+',form');for(var i=0;i<all.length;i++){send(fp(all[i],'seen'))}}
var ct=0;function sched(){if(ct)clearTimeout(ct);ct=setTimeout(function(){ct=0;census()},700)}
sched();try{new MutationObserver(sched).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}
})();</script>`;
http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/__cov?d=')) {
      try {
        const rows = JSON.parse(decodeURIComponent(req.url.slice(9)));
        for (const row of rows) appendFileSync(out, JSON.stringify(row) + '\n');
      } catch {}
      res.writeHead(204).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers['accept-encoding'];
    const up = http.request(
      { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers },
      (ur) => {
        const ct = String(ur.headers['content-type'] || '');
        if (!ct.startsWith('text/html')) {
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
          return;
        }
        const chunks = [];
        ur.on('data', (c) => chunks.push(c));
        ur.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          html = html.includes('</body>')
            ? html.replace('</body>', recorder + '</body>')
            : html + recorder;
          const h = { ...ur.headers };
          delete h['content-length'];
          delete h['transfer-encoding'];
          h['content-length'] = Buffer.byteLength(html);
          res.writeHead(ur.statusCode, h);
          res.end(html);
        });
      },
    );
    up.on('error', () => {
      res.writeHead(502).end('upstream unavailable');
    });
    req.pipe(up);
  })
  .listen(listen, '127.0.0.1');
