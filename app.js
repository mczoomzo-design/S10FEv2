/* admin.js — หน้าผู้ดูแลระบบ */

const DMG_LIST = ['จอแตก/ร้าว', 'เปิดไม่ติด / แบตเสีย', 'ตัวเครื่องบุบ/รอยขีดข่วน',
  'ปากกา S Pen หาย/ชำรุด', 'เคส/ที่ชาร์จ ไม่ครบ', 'อื่นๆ'];

let SESS = '';
let RECS = [];
let SUM = null;
let CUR = null;      // แถวที่กำลังคืน
let retUp;
let BUSY = false;

/** เรียก API พร้อม session */
function call(action, payload) { return api(action, Object.assign({ session: SESS }, payload || {})); }

async function boot() {
  if (!guardConfig()) return;
  $('#dmgList').innerHTML = DMG_LIST.map(d =>
    `<label class="chk"><input type="checkbox" value="${d}"><span>${d}</span></label>`).join('');
  $$('#dmgList input').forEach(c => c.onchange = e => e.target.closest('.chk').classList.toggle('on', e.target.checked));
  retUp = makeUploader({ box: '#upRet', bar: '#retBar', thumbs: '#retThumbs',
    defaultLabel: 'ถ่ายหรือเลือกไฟล์', onBusy: b => BUSY = b });
}

// ---------- login ----------
$('#go').onclick = login;
$('#p').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
async function login() {
  $('#loginErr').innerHTML = '';
  const btn = $('#go');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังเข้าสู่ระบบ…';
  try {
    const d = await api('adminLogin', { user: $('#u').value, pass: $('#p').value });
    SESS = d.session;
    $('#login').classList.add('hide');
    $('#dash').classList.remove('hide');
    await load();
  } catch (e) {
    $('#loginErr').innerHTML = `<div class="note err"><i class="ti ti-alert-circle"></i><div>${e.message}</div></div>`;
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-login"></i> เข้าสู่ระบบ';
  }
}

$('#logout').onclick = () => location.reload();

$('#refresh').onclick = async () => {
  const b = $('#refresh');
  const orig = b.innerHTML;
  b.disabled = true;
  b.innerHTML = '<span class="spin" style="border-color:rgba(18,35,59,.25);border-top-color:var(--ink)"></span> กำลังโหลด';
  try {
    await load();
    toast('อัปเดตข้อมูลแล้ว', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    b.disabled = false;
    b.innerHTML = orig;
  }
};

async function load() {
  try {
    const [sum, recs] = await Promise.all([call('adminSummary'), call('adminRecords')]);
    SUM = sum; RECS = recs.rows;
    renderKpis(); renderRecs(); renderSummary(); populateFilters();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- tabs ----------
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  const tab = t.dataset.tab;
  $('#tabRecords').classList.toggle('hide', tab !== 'records');
  $('#tabSummary').classList.toggle('hide', tab !== 'summary');
  $('#tabSettings').classList.toggle('hide', tab !== 'settings');
  if (tab === 'settings') loadSettings();
});

// ---------- KPIs ----------
function renderKpis() {
  const t = SUM.totals;
  $('#kpis').innerHTML = [
    ['borrow', t.borrowed, 'กำลังยืม'],
    ['return', t.returned, 'คืนแล้ว'],
    ['waive', t.waived, 'สละสิทธิ์'],
    ['pend', t.pending, 'ยังไม่รับ']
  ].map(([c, n, l]) => `<div class="kpi ${c}"><b>${n}</b><span>${l}</span></div>`).join('');
}

// ---------- filters ----------
function populateFilters() {
  const grades = [...new Set(SUM.rooms.map(r => r.grade))];
  ['#fg', '#tg'].forEach(sel => {
    const el = $(sel);
    const keep = el.value;
    el.innerHTML = '<option value="">' + (sel === '#tg' ? 'เลือก' : 'ทั้งหมด') + '</option>';
    grades.forEach(g => el.add(new Option(g, g)));
    el.value = keep;
  });
}
$('#fg').onchange = () => { syncRooms('#fg', '#fr', 'ทั้งหมด'); renderRecs(); };
$('#tg').onchange = () => syncRooms('#tg', '#tr2', 'เลือก');
function syncRooms(gSel, rSel, allLabel) {
  const g = $(gSel).value;
  const el = $(rSel);
  el.innerHTML = '<option value="">' + allLabel + '</option>';
  if (g) SUM.rooms.filter(x => x.grade === g).forEach(x => el.add(new Option('ห้อง ' + x.room, x.room)));
}
$('#ft').onchange = renderRecs;
$('#fr').onchange = renderRecs;
$('#fs').onchange = renderRecs;
$('#fq').oninput = renderRecs;

// ---------- records table ----------
function filtered() {
  const ty = $('#ft').value, g = $('#fg').value, r = $('#fr').value, s = $('#fs').value;
  const q = $('#fq').value.trim().toLowerCase();
  return RECS.filter(x => {
    if (ty && (x.type || 'นักเรียน') !== ty) return false;
    if (g && x.grade !== g) return false;
    if (r && x.room !== r) return false;
    if (s === '__d') { if (x.condition !== 'ชำรุด') return false; }
    else if (s === '__l') { if (x.condition !== 'สูญหาย') return false; }
    else if (s && x.status !== s) return false;
    if (q && !(x.name.toLowerCase().includes(q) || x.device.toLowerCase().includes(q) ||
      x.teacher.toLowerCase().includes(q) || (x.phone || '').includes(q))) return false;
    return true;
  });
}

function statusBadge(r) {
  const map = {
    'กำลังยืม': ['var(--warn-bg)', 'var(--warn)'],
    'คืนแล้ว': ['var(--ok-bg)', 'var(--ok)'],
    'สละสิทธิ์': ['var(--stamp-bg)', 'var(--stamp-ink)']
  };
  const [bg, c] = map[r.status] || ['var(--line-2)', 'var(--steel)'];
  return `<span class="bg" style="background:${bg};color:${c}">${r.status}</span>`;
}
function condBadge(r) {
  if (!r.condition) return '—';
  const map = { 'ปกติ': ['var(--ok-bg)', 'var(--ok)'], 'ชำรุด': ['var(--warn-bg)', 'var(--warn)'], 'สูญหาย': ['var(--danger-bg)', 'var(--danger)'] };
  const [bg, c] = map[r.condition] || ['var(--line-2)', 'var(--steel)'];
  return `<span class="bg" style="background:${bg};color:${c}">${r.condition}</span>`;
}

function renderRecs() {
  const list = filtered();
  $('#rCnt').textContent = list.length + ' รายการ';
  if (!list.length) {
    $('#recTb').innerHTML = '<tr><td colspan="10"><div class="empty"><i class="ti ti-inbox"></i><p>ไม่พบรายการ</p></div></td></tr>';
    return;
  }
  $('#recTb').innerHTML = list.map(r => {
    const cls = r.condition === 'สูญหาย' ? 'rl' : (r.condition === 'ชำรุด' ? 'rd' : '');
    const files = [
      r.photo ? `<a href="${r.photo}" target="_blank" title="ภาพรับ"><i class="ti ti-camera"></i></a>` : '',
      r.contracts ? r.contracts.split('\n').filter(Boolean).map((u, i) => `<a href="${u}" target="_blank" title="สัญญา ${i + 1}"><i class="ti ti-file-text"></i></a>`).join('') : '',
      r.waiveDoc ? `<a href="${r.waiveDoc}" target="_blank" title="เอกสารสละสิทธิ์"><i class="ti ti-file-off"></i></a>` : '',
      r.returnPhoto ? `<a href="${r.returnPhoto}" target="_blank" title="ภาพคืน"><i class="ti ti-arrow-back-up"></i></a>` : ''
    ].join(' ');
    const isT = r.type === 'ครู';
    const who = isT ? `<span class="bg" style="background:var(--blue-bg);color:var(--blue)">ครู</span>` : `<b>${r.grade}</b>/${r.room}`;
    const idcol = isT ? (r.phone || '—') : r.no;
    let act = '';
    if (r.status === 'กำลังยืม') act = `<button class="sm pri" data-ret="${r.row}" data-name="${r.name}" data-dev="${r.device}">คืน</button>`;
    else if (r.status === 'สละสิทธิ์' && !r.waiveDoc) act = `<button class="sm" data-attach="${r.row}" data-name="${r.name}">แนบเอกสาร</button>`;
    return `<tr class="${cls}">
      <td>${who}</td><td class="mono">${idcol}</td><td>${r.name}</td>
      <td class="mono">${r.device || '—'}</td><td>${statusBadge(r)}</td>
      <td class="mono">${thaiDate(r.receiveDate)}</td><td class="mono">${thaiDate(r.returnDate)}</td>
      <td>${condBadge(r)}</td><td style="font-size:15px">${files || '—'}</td><td>${act}</td>
    </tr>`;
  }).join('');
  $$('[data-ret]').forEach(b => b.onclick = () => openReturn(Number(b.dataset.ret), b.dataset.name, b.dataset.dev));
  $$('[data-attach]').forEach(b => b.onclick = () => attachDoc(Number(b.dataset.attach), b.dataset.name, b));
}

// ---------- summary ----------
function renderSummary() {
  $('#sumTb').innerHTML = SUM.rooms.map(m => `<tr>
    <td>${m.grade}/${m.room}</td><td>${m.total}</td><td>${m.borrowed}</td><td>${m.returned}</td>
    <td>${m.waived}</td><td>${m.pending}</td>
    <td${m.damaged ? ' style="color:var(--warn);font-weight:600"' : ''}>${m.damaged}</td>
    <td${m.lost ? ' style="color:var(--danger);font-weight:600"' : ''}>${m.lost}</td>
  </tr>`).join('') || '<tr><td colspan="8"><div class="empty"><p>ยังไม่มีข้อมูล</p></div></td></tr>';

  const t = SUM.teacher || { total: 0, borrowed: 0, returned: 0, waived: 0, damaged: 0, lost: 0 };
  $('#teacherSum').innerHTML = `<div class="step"><div class="step-n"><i class="ti ti-user" style="font-size:14px"></i></div><div class="step-t">ครู (รับเครื่องเอง)</div></div>
    <div class="kpis" style="margin:0">
      <div class="kpi"><b>${t.total}</b><span>ทั้งหมด</span></div>
      <div class="kpi borrow"><b>${t.borrowed}</b><span>กำลังยืม</span></div>
      <div class="kpi return"><b>${t.returned}</b><span>คืนแล้ว</span></div>
      <div class="kpi waive"><b>${t.waived}</b><span>สละสิทธิ์</span></div>
    </div>`;
}

// ---------- token ----------
$('#genTok').onclick = async () => {
  const g = $('#tg').value, r = $('#tr2').value;
  if (!g || !r) return toast('เลือกชั้นและห้องก่อน', 'err');
  $('#tokOut').innerHTML = '<div class="hint">กำลังสร้าง…</div>';
  try {
    const d = await call('adminIssueToken', { grade: g, room: r });
    if (d.needSiteUrl) {
      $('#tokOut').innerHTML = `<div class="note warn"><i class="ti ti-alert-triangle"></i><div>สร้าง token แล้ว (<b class="mono">${d.token}</b>) แต่ยังไม่ได้ตั้ง URL เว็บไซต์ — ไปที่แท็บ "ตั้งค่า" เพื่อกรอก URL ก่อน ระบบจึงจะสร้างลิงก์เต็มให้</div></div>`;
      return;
    }
    $('#tokOut').innerHTML = `<div class="note ok"><i class="ti ti-check"></i><div style="min-width:0">
      <b>ลิงก์คืนเครื่อง ${g}/${r}</b>
      <div class="mono" style="font-size:12px;word-break:break-all;margin:6px 0">${d.url}</div>
      <button class="sm pri" id="copyTok"><i class="ti ti-copy"></i> คัดลอกลิงก์</button>
    </div></div>`;
    $('#copyTok').onclick = () => { navigator.clipboard.writeText(d.url); toast('คัดลอกแล้ว', 'ok'); };
  } catch (e) { $('#tokOut').innerHTML = `<div class="note err"><i class="ti ti-alert-circle"></i><div>${e.message}</div></div>`; }
};

// ---------- CSV export ----------
$('#exp').onclick = () => {
  const H = ['ประเภท', 'ชั้น', 'ห้อง', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'เบอร์โทร', 'ครูที่ปรึกษา', 'เลขเครื่อง', 'สถานะ',
    'วันที่รับ', 'วันที่คืน', 'สภาพเครื่อง', 'รายการชำรุด', 'หมายเหตุ', 'ผู้รับคืน', 'เหตุผลสละสิทธิ์'];
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = filtered().map(r => [r.type || 'นักเรียน', r.grade, r.room, r.no, r.name, r.phone || '', r.teacher, r.device, r.status,
    thaiDate(r.receiveDate), thaiDate(r.returnDate), r.condition, r.damage, r.note, r.receiver, r.waiveReason].map(esc).join(','));
  const csv = '\ufeff' + [H.map(esc).join(','), ...rows].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'S10FE-records-' + todayISO() + '.csv';
  a.click(); URL.revokeObjectURL(url);
  toast('ดาวน์โหลด CSV แล้ว', 'ok');
};

// ---------- return modal ----------
function openReturn(row, name, dev) {
  CUR = row;
  $('#mName').textContent = name;
  $('#mDev').textContent = dev || 'ไม่มีเลขเครื่อง';
  $('#mDate').value = todayISO();
  $('#mThai').textContent = 'พ.ศ. ' + thaiDate(todayISO());
  $$('input[name=cond]').forEach(x => x.checked = false);
  $$('#conds .rad').forEach(x => x.classList.remove('on'));
  $$('#dmgList input').forEach(x => { x.checked = false; x.closest('.chk').classList.remove('on'); });
  $('#dmgPane').classList.add('hide');
  $('#mNote').value = '';
  $('#noteReq').classList.add('hide');
  $('#picReq').classList.add('hide');
  retUp.reset();
  $('#mErr').innerHTML = '';
  $('#mSave').disabled = false;
  $('#mSave').innerHTML = '<i class="ti ti-check"></i> บันทึกคืน';
  $('#mask').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeReturn() { $('#mask').classList.remove('on'); document.body.style.overflow = ''; CUR = null; }
$('#mClose').onclick = closeReturn;
$('#mCancel').onclick = closeReturn;
$('#mask').onclick = e => { if (e.target === $('#mask')) closeReturn(); };
$('#mDate').onchange = e => $('#mThai').textContent = e.target.value ? 'พ.ศ. ' + thaiDate(e.target.value) : '';

$$('input[name=cond]').forEach(r => r.onchange = e => {
  $$('#conds .rad').forEach(x => x.classList.remove('on'));
  e.target.closest('.rad').classList.add('on');
  const v = e.target.value;
  $('#dmgPane').classList.toggle('hide', v !== 'ชำรุด');
  $('#noteReq').classList.toggle('hide', v !== 'สูญหาย');
  $('#picReq').classList.toggle('hide', v !== 'ชำรุด');
  $('#picPane').classList.toggle('hide', v === 'สูญหาย');
  $('#mErr').innerHTML = '';
});

function mErr(m) { $('#mErr').innerHTML = `<div class="note err"><i class="ti ti-alert-circle"></i><div>${m}</div></div>`; }

$('#mSave').onclick = async () => {
  $('#mErr').innerHTML = '';
  if (BUSY) return toast('รอรูปประมวลผลเสร็จก่อน', 'err');
  const cond = ($$('input[name=cond]').find(x => x.checked) || {}).value;
  if (!cond) return mErr('กรุณาเลือกสภาพเครื่อง');
  if (!$('#mDate').value) return mErr('กรุณาระบุวันที่คืน');
  let dmg = [];
  if (cond === 'ชำรุด') {
    dmg = $$('#dmgList input:checked').map(x => x.value);
    if (!dmg.length) return mErr('กรุณาติ๊กรายการชำรุดอย่างน้อย 1 รายการ');
    if (!retUp.count()) return mErr('กรณีชำรุด ต้องแนบภาพถ่ายตอนคืน');
  }
  if (cond === 'สูญหาย' && !$('#mNote').value.trim()) return mErr('กรณีสูญหาย ต้องกรอกหมายเหตุ');

  const btn = $('#mSave');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังบันทึก…';
  try {
    await call('adminReturn', { row: CUR, returnDate: $('#mDate').value, condition: cond,
      damage: dmg, note: $('#mNote').value, photo: retUp.getValue() });
    toast('บันทึกการคืนเรียบร้อย', 'ok');
    closeReturn();
    await load();
  } catch (e) {
    mErr(e.message);
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> บันทึกคืน';
  }
};

// ---------- attach waiver doc later ----------
async function attachDoc(row, name, btn) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('รองรับเฉพาะรูปภาพ', 'err');
    if (f.size > 12 * 1024 * 1024) return toast('ไฟล์ใหญ่เกิน 12 MB', 'err');
    btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-color:rgba(18,35,59,.25);border-top-color:var(--ink)"></span>';
    try {
      const doc = await compressImage(f, 1400, .8);
      await call('adminAttachWaiveDoc', { row, doc });
      toast('แนบเอกสารของ ' + name + ' แล้ว', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.textContent = 'แนบเอกสาร';
    }
  };
  inp.click();
}

// ---------- settings ----------
async function loadSettings() {
  try {
    const d = await call('adminGetSettings');
    $('#setUrl').value = d.siteUrl || '';
    const owner = d.folderOwner ? ' · เจ้าของ: ' + d.folderOwner : '';
    $('#folderInfo').innerHTML = d.folderErr
      ? `<span style="color:var(--danger)">${d.folderErr}</span>`
      : `โฟลเดอร์ปัจจุบัน: <a href="${d.folderUrl}" target="_blank" style="color:var(--blue)">${d.folderName}</a>${owner}<br>บัญชีสคริปต์: <span class="mono">${d.scriptAccount}</span>`;
  } catch (e) { toast(e.message, 'err'); }
}
$('#saveUrl').onclick = () => saveSetting({ siteUrl: $('#setUrl').value }, 'บันทึก URL แล้ว');
$('#savePass').onclick = () => {
  if (!$('#setPass').value.trim()) return toast('กรอกรหัสผ่านใหม่ก่อน', 'err');
  saveSetting({ newPass: $('#setPass').value }, 'เปลี่ยนรหัสผ่านแล้ว', () => $('#setPass').value = '');
};
$('#saveFolder').onclick = () => {
  if (!$('#setFolder').value.trim()) return toast('วาง URL หรือ ID โฟลเดอร์ก่อน', 'err');
  saveSetting({ folderId: $('#setFolder').value }, 'ย้ายโฟลเดอร์แล้ว', () => { $('#setFolder').value = ''; loadSettings(); });
};
async function saveSetting(payload, okMsg, after) {
  $('#setErr').innerHTML = '';
  try {
    await call('adminSaveSettings', payload);
    toast(okMsg, 'ok');
    if (after) after();
  } catch (e) {
    $('#setErr').innerHTML = `<div class="note err"><i class="ti ti-alert-circle"></i><div>${e.message}</div></div>`;
  }
}

boot();
