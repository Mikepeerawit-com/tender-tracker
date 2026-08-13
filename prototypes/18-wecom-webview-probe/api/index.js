// Ticket 18 (#19) — WeCom in-app webview probe.
//
// Serves the whole probe page from a serverless function, because one of the six
// rows (L3b) needs a cookie the SERVER set — the point being that a cookie, unlike
// localStorage, is out of reach of WebKit's seven-day sweep of script-writable
// storage (docs/research/17-wecom-webview.md §3.2).
//
// The cookie is HttpOnly on purpose. JS cannot read it, so the value shown on the
// page is the one the browser sent *back* to the server — which proves the whole
// round trip, not just that a string survived on disk.

const COOKIE = 'probe_sid';
const YEAR = 60 * 60 * 24 * 365;

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export default function handler(req, res) {
  const existing = readCookie(req.headers.cookie, COOKIE);
  const now = new Date().toISOString();

  let sid = existing;
  let cookieState = 'PERSISTED';
  if (!sid) {
    sid = now + '|' + Math.random().toString(36).slice(2, 8);
    cookieState = 'NEW — just set';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${encodeURIComponent(sid)}; Max-Age=${YEAR}; Path=/; Secure; HttpOnly; SameSite=Lax`
    );
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(page({ sid, cookieState, now }));
}

function page({ sid, cookieState, now }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>WeCom webview probe — ticket 18</title>
<style>
  :root { color-scheme: light; }
  body {
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0; padding: 16px 14px 64px; background: #fff; color: #111;
    -webkit-text-size-adjust: 100%;
  }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; margin: 0 0 20px; }
  section { border: 2px solid #111; border-radius: 10px; padding: 12px; margin: 0 0 14px; }
  h2 { font-size: 15px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .06em; }
  .row { margin: 0 0 8px; }
  .k { font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: .05em; }
  .v { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14px;
       word-break: break-all; background: #f4f4f4; padding: 6px 8px; border-radius: 6px; }
  .big { font-size: 22px; font-weight: 700; padding: 8px; text-align: center; border-radius: 8px; }
  .yes { background: #d8f5d8; color: #04520b; }
  .no  { background: #ffe0e0; color: #7a0b0b; }
  .warn { background: #fff3cd; color: #6b4b00; }
  button, label.file {
    display: block; width: 100%; box-sizing: border-box; margin: 10px 0 0;
    font-size: 18px; font-weight: 600; padding: 16px; border-radius: 10px;
    border: 2px solid #111; background: #111; color: #fff; text-align: center;
    -webkit-appearance: none; cursor: pointer;
  }
  button[disabled] { opacity: .4; }
  label.file { background: #fff; color: #111; }
  input[type=file] { position: absolute; left: -9999px; }
  img.preview { display: block; width: 200px; max-width: 100%; margin: 10px auto 0;
                border: 2px dashed #888; background:
                repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/16px 16px; }
  .tag { display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 8px;
         border-radius: 20px; background: #111; color: #fff; }
</style>
</head>
<body>

<h1>WeCom webview probe</h1>
<p class="sub">Ticket 18 · loaded ${now}</p>

<section>
  <h2>L2 · Engine</h2>
  <div class="row">
    <div class="k">Is this WeCom? (/wxwork/i)</div>
    <div id="wxwork" class="big">…</div>
  </div>
  <div class="row">
    <div class="k">Discriminator — wxwork first, then MicroMessenger</div>
    <div id="verdict" class="v">…</div>
  </div>
  <div class="row">
    <div class="k">navigator.userAgent (verbatim)</div>
    <div id="ua" class="v">…</div>
  </div>
  <div class="row">
    <div class="k">Engine tokens</div>
    <div id="engine" class="v">…</div>
  </div>
</section>

<section>
  <h2>L3 · localStorage</h2>
  <div class="row">
    <div class="k">State</div>
    <div id="lsState" class="big">…</div>
  </div>
  <div class="row">
    <div class="k">Written at</div>
    <div id="lsValue" class="v">…</div>
  </div>
</section>

<section>
  <h2>L3b · Server-set cookie (HttpOnly)</h2>
  <div class="row">
    <div class="k">State</div>
    <div class="big ${cookieState === 'PERSISTED' ? 'yes' : 'warn'}">${cookieState}</div>
  </div>
  <div class="row">
    <div class="k">Value the browser sent back to the server</div>
    <div class="v">${sid}</div>
  </div>
  <p class="sub" style="margin:8px 0 0">JS cannot read this one — it is HttpOnly, so what
  you see above arrived on the request. Same value after a force-quit = it survived.</p>
</section>

<section>
  <h2>L4 · Camera</h2>
  <label class="file" for="f">Tap to open the picker</label>
  <input id="f" type="file" accept="image/*" capture="environment">
  <div class="row" style="margin-top:10px">
    <div class="k">Selected file</div>
    <div id="fileInfo" class="v">nothing selected</div>
  </div>
</section>

<section>
  <h2>L6 · Compress &amp; upload</h2>
  <button id="go" disabled>Compress &amp; upload</button>
  <div class="row" style="margin-top:10px">
    <div class="k">Compression</div>
    <div id="compInfo" class="v">—</div>
  </div>
  <div class="row">
    <div class="k">Blank/black check</div>
    <div id="blank" class="v">—</div>
  </div>
  <div class="row">
    <div class="k">Upload (cross-origin PUT to supabase.co)</div>
    <div id="upInfo" class="v">—</div>
  </div>
  <img id="preview" class="preview" alt="compressed result renders here">
  <p class="sub" style="margin:8px 0 0">If the box above is a chequerboard, nothing
  rendered. If it is a flat black or white rectangle, that is §5.3's canvas failure.</p>
</section>

<section>
  <h2>L1 &amp; L5 · Not on the page</h2>
  <p class="sub" style="margin:0">L1 is the banner — look at the very top and bottom of
  this screen, outside the page. L5 is the ⋯ menu in WeCom's own chrome. Both are things
  the page cannot see; that is why they need your eyes.</p>
</section>

<script>
(function () {
  var ua = navigator.userAgent;
  var isWeCom = /wxwork/i.test(ua);
  var isWeChat = /micromessenger/i.test(ua) && !isWeCom;

  document.getElementById('ua').textContent = ua;
  var w = document.getElementById('wxwork');
  w.textContent = isWeCom ? 'YES — wxwork present' : 'NO — no wxwork token';
  w.className = 'big ' + (isWeCom ? 'yes' : 'no');
  document.getElementById('verdict').textContent =
    isWeCom ? 'WeCom (企业微信)' : isWeChat ? 'consumer WeChat — NOT WeCom' : 'neither — ordinary browser';

  var tokens = [];
  ['TBS/', 'XWEB/', 'Chrome/', 'Version/', 'Safari/', 'MicroMessenger/', 'wxwork/'].forEach(function (t) {
    var m = ua.match(new RegExp(t.replace('/', '\\\\/') + '([0-9.]+)'));
    if (m) tokens.push(t + m[1]);
  });
  document.getElementById('engine').textContent = tokens.length ? tokens.join('   ') : 'no version tokens found';

  // L3 — localStorage, written once, read back on every load.
  var lsState = document.getElementById('lsState');
  var lsValue = document.getElementById('lsValue');
  try {
    var stored = localStorage.getItem('probe_ls');
    if (stored) {
      lsState.textContent = 'PERSISTED';
      lsState.className = 'big yes';
    } else {
      stored = new Date().toISOString();
      localStorage.setItem('probe_ls', stored);
      lsState.textContent = 'NEW — just written';
      lsState.className = 'big warn';
    }
    lsValue.textContent = stored;
  } catch (e) {
    lsState.textContent = 'BLOCKED';
    lsState.className = 'big no';
    lsValue.textContent = e.name + ': ' + e.message;
  }

  // L4 — the picker, and what it hands back.
  var file = null;
  var input = document.getElementById('f');
  var fileInfo = document.getElementById('fileInfo');
  var go = document.getElementById('go');

  input.addEventListener('change', function () {
    file = input.files && input.files[0];
    if (!file) { fileInfo.textContent = 'picker returned nothing'; return; }
    fileInfo.textContent = 'name: ' + file.name + '\\ntype: ' + (file.type || '(empty)') +
                           '\\nsize: ' + Math.round(file.size / 1024) + ' KB';
    fileInfo.style.whiteSpace = 'pre';
    var img = new Image();
    img.onload = function () {
      fileInfo.textContent += '\\nnatural: ' + img.naturalWidth + ' × ' + img.naturalHeight +
                              '  (' + (img.naturalWidth * img.naturalHeight / 1e6).toFixed(1) + ' MP)';
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function () { fileInfo.textContent += '\\nnatural: FAILED TO DECODE'; };
    img.src = URL.createObjectURL(file);
    go.disabled = false;
  });

  // L6 — compress, check it is not blank, then PUT it cross-origin.
  go.addEventListener('click', function () {
    if (!file) return;
    go.disabled = true;
    var compInfo = document.getElementById('compInfo');
    var blankEl = document.getElementById('blank');
    var upInfo = document.getElementById('upInfo');
    compInfo.textContent = 'working…';
    blankEl.textContent = '—';
    upInfo.textContent = '—';

    compress(file).then(function (r) {
      compInfo.textContent = 'path: ' + r.path + '\\nout: ' + r.width + ' × ' + r.height +
                             '\\nbytes: ' + Math.round(r.blob.size / 1024) + ' KB';
      compInfo.style.whiteSpace = 'pre';
      blankEl.textContent = r.uniform
        ? 'UNIFORM — every sampled pixel identical. This is the §5.3 failure.'
        : 'OK — ' + r.distinct + ' distinct colours sampled';
      blankEl.className = 'v ' + (r.uniform ? 'no' : 'yes');
      document.getElementById('preview').src = URL.createObjectURL(r.blob);
      return upload(r.blob);
    }).then(function (msg) {
      upInfo.textContent = msg;
      go.disabled = false;
    }).catch(function (e) {
      upInfo.textContent = 'FAILED — ' + e.name + ': ' + e.message +
        '\\n(a bare "TypeError: Failed to fetch" here is what a CORS rejection looks like)';
      upInfo.style.whiteSpace = 'pre';
      upInfo.className = 'v no';
      go.disabled = false;
    });
  });

  // §5.3 — prefer createImageBitmap's resize over drawing a 12 MP photo into a canvas,
  // and fall back to STEPPED halving rather than one big draw.
  function compress(f) {
    var MAX = 1600;
    return decode(f).then(function (src) {
      var scale = Math.min(1, MAX / Math.max(src.width, src.height));
      var tw = Math.max(1, Math.round(src.width * scale));
      var th = Math.max(1, Math.round(src.height * scale));

      if (typeof createImageBitmap === 'function') {
        return createImageBitmap(f, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' })
          .then(function (bm) { return draw(bm, tw, th, 'createImageBitmap'); })
          .catch(function () { return stepped(src, tw, th); });
      }
      return stepped(src, tw, th);
    });
  }

  function decode(f) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('image decode failed')); };
      img.src = URL.createObjectURL(f);
    });
  }

  function stepped(src, tw, th) {
    var cw = src.naturalWidth || src.width, ch = src.naturalHeight || src.height;
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0, cw, ch);
    while (cw / 2 > tw) {
      var next = document.createElement('canvas');
      next.width = Math.round(cw / 2); next.height = Math.round(ch / 2);
      next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height);
      canvas = next; cw = next.width; ch = next.height;
    }
    var out = document.createElement('canvas');
    out.width = tw; out.height = th;
    out.getContext('2d').drawImage(canvas, 0, 0, tw, th);
    return finish(out, 'stepped canvas halving');
  }

  function draw(bm, tw, th, path) {
    var c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(bm, 0, 0, tw, th);
    return finish(c, path);
  }

  function finish(canvas, path) {
    var check = sample(canvas);
    return new Promise(function (res, rej) {
      canvas.toBlob(function (blob) {
        if (!blob) { rej(new Error('toBlob returned null')); return; }
        res({ blob: blob, width: canvas.width, height: canvas.height, path: path,
              uniform: check.uniform, distinct: check.distinct });
      }, 'image/jpeg', 0.8);
    });
  }

  function sample(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var seen = {}, n = 0;
      for (var i = 0; i < 400; i++) {
        var x = Math.floor(Math.random() * canvas.width);
        var y = Math.floor(Math.random() * canvas.height);
        var d = ctx.getImageData(x, y, 1, 1).data;
        var key = d[0] + ',' + d[1] + ',' + d[2];
        if (!seen[key]) { seen[key] = 1; n++; }
      }
      return { uniform: n <= 1, distinct: n };
    } catch (e) {
      return { uniform: false, distinct: 'unreadable (' + e.name + ')' };
    }
  }

  // The server mints the URL with createSignedUploadUrl(); the browser PUTs to it.
  // Nothing here is a hand-assembled storage URL — see §5.2.
  function upload(blob) {
    return fetch('/api/sign', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error('sign failed: ' + j.error);
        var t0 = Date.now();
        return fetch(j.url, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' },
          body: blob
        }).then(function (r) {
          return r.text().then(function (body) {
            return 'HTTP ' + r.status + ' ' + r.statusText +
                   '  (' + (Date.now() - t0) + ' ms)\\n' + body.slice(0, 200);
          });
        });
      });
  }
})();
</script>
</body>
</html>`;
}
