/* return.js — ครูที่ปรึกษาคืนเครื่องนักเรียน (เข้าด้วย ?token=) */

const DMG_LIST = ['จอแตก/ร้าว', 'เปิดไม่ติด / แบตเสีย', 'ตัวเครื่องบุบ/รอยขีดข่วน',
  'ปากกา S Pen หาย/ชำรุด', 'เคส/ที่ชาร์จ ไม่ครบ', 'อื่นๆ'];

let TOKEN = '';
let ROWS = [];
let CUR = null;      // แถวที่กำลังคืน
let retUp;
let BUSY = false;

function getToken() {
  const m = location.search.match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function boot() {
  if (!guardConfig()) return;
  TOKEN = getToken();
  if (!TOKEN) return fail('ไม่พบ token ในลิงก์ — กรุณาใช้ลิงก์ที่ผู้ดูแลระบบสร้างให้');

  // เตรียม modal
  $('#dmgList').innerHTML = DMG_LIST.map(d =>
    `<label class="chk"><input type="checkbox" value="${d}"><span>${d}</span></label>`).join('');
  $$('#dmgList input').forEach(c => c.onchange = e => e.target.closest('.chk').classList.toggle('on', e.target.checked));
  retUp = makeUploader({ box: '#upRet', bar: '#retBar', thumbs: '#retThumbs',
    defaultLabel: 'ถ่ายหรือเลือกไฟล์', onBusy: b => BUSY = b });

  try {
    const d = await api('getClassRoster', { token: TOKEN });
    $('#hdSub').textContent = d.teacher.teacher;
    $('#clsName').textContent = 'ห้อง ' + d.teacher.grade + '/' + d.teacher.room;
    ROWS = d.rows;
    $('#loading').classList.add('hide');
    $('#main').classList.remove('hide');
    render();
  } catch (e) {
    fail(e.message);
  }
}

function fail(msg) {
  $('#loading').classList.add('hide');
  $('#badToken').classList.remove('hide');
  $('#badTxt').textContent = msg;
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const list = ROWS.filter(r => !q || r.no.toLowerCase().includes(q) ||
    r.name.toLowerCase().includes(q) || (r.device || '').toLowerCase().includes(q));
  const borrowed = list.filter(r => r.status === 'กำลังยืม').length;
  $('#cnt').textContent = 'กำลังยืม ' + borrowed + ' / ' + list.length + ' คน';

  if (!list.length) {
    $('#rows').innerHTML = '<div class="card"><div class="empty"><i class="ti ti-inbox"></i><p>ไม่พบรายการ</p></div></div>';
    return;
  }
  $('#rows').innerHTML = list.map(r => {
    const st = statusMark(r);
    const canReturn = r.status === 'กำลังยืม';
    return `<div class="rrow">
      <div class="rrow-n">${r.no}</div>
      <div class="rrow-m"><b>${r.name}</b><span>${r.device || 'ไม่มีเลขเครื่อง'}</span></div>
      ${st}
      ${canReturn ? `<button class="sm pri" data-row="${r.row}">คืน</button>` : ''}
    </div>`;
  }).join('');
  $$('[data-row]').forEach(b => b.onclick = () => openModal(Number(b.dataset.row)));
}

function statusMark(r) {
  if (r.status === 'กำลังยืม') return '<span class="bg" style="background:var(--warn-bg);color:var(--warn)">กำลังยืม</span>';
  if (r.status === 'สละสิทธิ์') return '<span class="bg" style="background:var(--stamp-bg);color:var(--stamp-ink)">สละสิทธิ์</span>';
  const cond = r.condition;
  const color = cond === 'สูญหาย' ? 'var(--danger)' : (cond === 'ชำรุด' ? 'var(--warn)' : 'var(--ok)');
  const bg = cond === 'สูญหาย' ? 'var(--danger-bg)' : (cond === 'ชำรุด' ? 'var(--warn-bg)' : 'var(--ok-bg)');
  return `<span class="bg" style="background:${bg};color:${color}">คืนแล้ว${cond && cond !== 'ปกติ' ? '·' + cond : ''}</span>`;
}

$('#search').oninput = render;

function openModal(row) {
  CUR = ROWS.find(r => r.row === row);
  if (!CUR) return;
  $('#mName').textContent = CUR.name + ' (เลขที่ ' + CUR.no + ')';
  $('#mDev').textContent = CUR.device || 'ไม่มีเลขเครื่อง';
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
function closeModal() { $('#mask').classList.remove('on'); document.body.style.overflow = ''; CUR = null; }
$('#mClose').onclick = closeModal;
$('#mCancel').onclick = closeModal;
$('#mask').onclick = e => { if (e.target === $('#mask')) closeModal(); };
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
    await api('submitReturn', { token: TOKEN, row: CUR.row, returnDate: $('#mDate').value,
      condition: cond, damage: dmg, note: $('#mNote').value, photo: retUp.getValue() });
    toast('บันทึกคืนเครื่องของ ' + CUR.name + ' แล้ว', 'ok');
    // อัปเดตสถานะในหน้า
    CUR.status = 'คืนแล้ว'; CUR.condition = cond; CUR.returnDate = $('#mDate').value;
    closeModal();
    render();
  } catch (e) {
    mErr(e.message);
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> บันทึกคืน';
  }
};

boot();
