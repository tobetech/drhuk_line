(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'qimen_order_v1';
  var topic = null, token = null, expiresAt = 0, timer = null, poller = null, busy = false;

  function show(id) {
    ['step-pick', 'step-pay', 'step-wait', 'step-result', 'step-end'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }
  function save(t) { try { localStorage.setItem(KEY, t); } catch (e) { /* ไม่เป็นไร */ } }
  function load() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ไม่เป็นไร */ } }
  function stop() { clearInterval(timer); clearInterval(poller); timer = poller = null; }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._http = r.status; return j; }); });
  }

  function end(title, text) {
    stop(); clear();
    $('end-title').textContent = title; $('end-text').textContent = text; show('step-end');
  }

  function renderResult(r, ref) {
    stop();
    $('res-title').textContent = '🧭 ฤกษ์ยาม · ' + r.topic;
    $('res-time').textContent = r.from && r.until ? 'ผังนี้ใช้ได้ ' + r.from + '–' + r.until + ' น. (เวลาไทย)' : 'ผังฉีเหมินตามเวลาที่ชำระเงิน';
    var g = $('grid'); g.textContent = '';
    r.grid.forEach(function (row) {
      row.forEach(function (c) {
        var d = document.createElement('div'); d.className = 'cell ' + (c.kind || ''); d.setAttribute('role', 'cell');
        [['d', c.dir || 'กลาง'], ['m', c.door], ['s', c.sub]].forEach(function (p) {
          var s = document.createElement('span'); s.className = p[0]; s.textContent = p[1]; d.appendChild(s);
        });
        g.appendChild(d);
      });
    });
    var dirs = $('dirs'); dirs.textContent = '';
    [['ok', '✅ ทิศที่เอื้อ: ', r.best], ['no', '⚠️ ทิศที่ควรเลี่ยง: ', r.avoid]].forEach(function (x) {
      if (!x[2]) return;
      var p = document.createElement('p'), b = document.createElement('span');
      b.className = x[0]; b.textContent = x[1]; p.appendChild(b);
      p.appendChild(document.createTextNode(x[2].direction + ' · ' + x[2].door)); dirs.appendChild(p);
    });
    $('reading').textContent = r.reading;
    $('ref3').textContent = ref || '-';
    show('step-result');
  }

  function tick() {
    var left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    $('countdown').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  }

  function poll() {
    if (busy || !token) return;
    busy = true;
    api('/api/qimen/order/' + token).then(function (j) {
      busy = false;
      if (j.status === 'done') return renderResult(j.result, j.ref);
      if (j.status === 'notfound') return end('ไม่พบรายการนี้', 'รายการนี้หมดอายุหรือไม่มีอยู่แล้ว หากชำระเงินแล้วแต่ไม่ได้ผล โปรดติดต่อผู้ให้บริการพร้อมรหัสอ้างอิง');
      if (j.status === 'expired') return end('QR หมดอายุแล้ว', 'หากคุณยังไม่ได้ชำระเงิน กรุณาเริ่มรายการใหม่ ถ้าชำระเงินแล้วแต่ไม่ได้ผล โปรดติดต่อผู้ให้บริการพร้อมรหัสอ้างอิง ' + (j.ref || ''));
      if (j.status === 'failed') {
        stop(); $('wait-text').textContent = 'ได้รับชำระเงินแล้ว แต่ระบบสร้างผลขัดข้อง กรุณาติดต่อผู้ให้บริการพร้อมรหัสอ้างอิงด้านล่าง เราจะดำเนินการให้หรือคืนเงิน';
        $('ref2').textContent = j.ref || '-'; return show('step-wait');
      }
      if (j.status === 'working') { $('ref2').textContent = j.ref || '-'; if ($('step-wait').hidden) { stop(); poller = setInterval(poll, 4000); show('step-wait'); } }
    }).catch(function () { busy = false; });
  }

  function startPolling() {
    stop(); tick();
    timer = setInterval(tick, 1000);
    poller = setInterval(poll, 4000);
    poll();
  }

  function resume(t) {
    token = t; save(t);
    api('/api/qimen/order/' + t).then(function (j) {
      if (j.status === 'done') return renderResult(j.result, j.ref);
      if (j.status === 'waiting') {
        expiresAt = j.expiresAt; $('qr').src = '/api/qimen/qr/' + t + '.png';
        $('ref').textContent = t.slice(0, 8).toUpperCase(); show('step-pay'); return startPolling();
      }
      if (j.status === 'working') { show('step-wait'); return startPolling(); }
      clear(); token = null;
    });
  }

  function pick(key) {
    topic = key;
    Array.prototype.forEach.call(document.querySelectorAll('.topic'), function (b) { b.setAttribute('aria-checked', b.dataset.key === key ? 'true' : 'false'); });
    $('buy').disabled = false; $('buy').textContent = $('buy').dataset.label;
  }

  $('buy').addEventListener('click', function () {
    if (!topic) return;
    $('buy').disabled = true; $('pick-error').hidden = true;
    api('/api/qimen/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topic }) }).then(function (j) {
      $('buy').disabled = false;
      if (!j.token) { $('pick-error').textContent = j.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'; $('pick-error').hidden = false; return; }
      $('pay-amount').textContent = j.amount; token = j.token; save(token); expiresAt = j.expiresAt;
      $('qr').src = '/api/qimen/qr/' + token + '.png'; $('ref').textContent = token.slice(0, 8).toUpperCase();
      $('pay-status').textContent = 'รอการชำระเงิน…'; show('step-pay'); startPolling();
    }).catch(function () { $('buy').disabled = false; $('pick-error').textContent = 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง'; $('pick-error').hidden = false; });
  });
  $('cancel').addEventListener('click', function () { stop(); clear(); token = null; show('step-pick'); });
  function back() { stop(); clear(); token = null; show('step-pick'); }
  $('again').addEventListener('click', back); $('restart').addEventListener('click', back);

  api('/api/qimen/config').then(function (c) {
    if (!c.topics) { $('pick-error').textContent = c.error || 'บริการยังไม่เปิดให้ใช้งาน'; $('pick-error').hidden = false; return; }
    var box = $('topics');
    c.topics.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'topic'; b.dataset.key = t.key;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      var e = document.createElement('span'); e.className = 'em'; e.textContent = t.emoji; b.appendChild(e);
      b.appendChild(document.createTextNode(t.label));
      b.addEventListener('click', function () { pick(t.key); }); box.appendChild(b);
    });
    $('pay-amount').textContent = c.price;
    $('buy').dataset.label = 'ชำระ ' + c.price + ' บาท แล้วดูฤกษ์ยามเลย';
    var saved = load(); if (/^[0-9a-f]{48}$/.test(saved || '')) resume(saved);
  });
})();
