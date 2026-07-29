/* teacher.js — หน้ารับเครื่องครู (พิมพ์ชื่อ+เบอร์เอง ไม่มี cascade) */

let MODE = '';
let DEVICES_LOADED = false;
let FREE = [], USED = [];
let BUSY = false;
let photoUp, conUp, waiveUp;

function setBusy(b) { BUSY = b; }

async function boot() {
  if (!guardConfig()) return;
  $('#recvDate').value = todayISO();
  $('#recvThai').textContent = 'พ.ศ. ' + thaiDate(todayISO());

  photoUp = makeUploader({ box: '#upPhoto', bar: '#upBar', barText: '#upBarTxt',
    defaultLabel: '1 รูป · ถ่ายหรือเลือกไฟล์', onChange: syncUpStat, onBusy: setBusy });
  conUp = makeUploader({ box: '#upCon', bar: '#upBar', barText: '#upBarTxt', thumbs: '#conThumbs',
    multi: true, max: 3, defaultLabel: '2–3 หน้า · ถ่ายหรือเลือกไฟล์', onChange: syncUpStat, onBusy: setBusy });
  waiveUp = makeUploader({ box: '#upWaive', bar: '#wBar', barText: '#wBarTxt', thumbs: '#waiveThumbs',
    defaultLabel: '1 รูป · ถ่ายหรือเลือกไฟล์', onBusy: setBusy });
}

function syncUpStat() {
  const n = (photoUp.count() ? 1 : 0) + (conUp.count() >= 2 ? 1 : 0);
  $('#upStat').textContent = n + ' / 2';
}

// ตรวจเบอร์โทร
$('#tphone').oninput = e => {
  const v = e.target.value.replace(/\D/g, '');
  const h = $('#phoneHint');
  if (!v) { h.className = 'hint'; h.textContent = ''; return; }
  if (v.length === 10) { h.className = 'hint ok'; h.textContent = '✓ เบอร์ถูกต้อง'; }
  else { h.className = 'hint warn'; h.textContent = 'เบอร์ควรมี 10 หลัก'; }
};

$('#recvDate').onchange = e => $('#recvThai').textContent = e.target.value ? 'พ.ศ. ' + thaiDate(e.target.value) : '';

$$('.mode').forEach(m => m.onclick = async () => {
  $$('.mode').forEach(x => x.classList.remove('on'));
  m.classList.add('on');
  MODE = m.dataset.mode;
  clearErr();
  $('#paneRecv').classList.toggle('hide', MODE !== 'receive');
  $('#paneWaive').classList.toggle('hide', MODE !== 'waive');
  $('#btns').style.display = 'flex';
  const btn = $('#submit');
  btn.className = 'b ' + (MODE === 'waive' ? 'dan' : 'pri');
  btn.innerHTML = MODE === 'waive' ? '<i class="ti ti-ban"></i> ยืนยันสละสิทธิ์' : '<i class="ti ti-send"></i> ส่งข้อมูล';
  if (MODE === 'receive') await loadDevices();
});

async function loadDevices() {
  if (DEVICES_LOADED) return;
  try {
    const d = await api('getDevices');
    FREE = d.free || []; USED = d.used || [];
    DEVICES_LOADED = true;
    $('#devList').innerHTML = FREE.map(x => `<option value="${x}"></option>`).join('');
    checkDevice();
  } catch (e) { $('#devHint').textContent = 'โหลดรายการไม่สำเร็จ — พิมพ์เลขเครื่องเองได้'; }
}

function checkDevice() {
  const v = $('#device').value.trim();
  const h = $('#devHint');
  if (!v) {
    h.className = 'hint';
    h.textContent = FREE.length ? 'เครื่องว่าง ' + FREE.length + ' เครื่อง — พิมพ์เองได้ถ้าไม่มีในรายการ'
      : 'ยังไม่มีรายการเครื่องในระบบ — พิมพ์เลขเครื่องได้เลย';
    return;
  }
  const taken = USED.find(u => u.device.toLowerCase() === v.toLowerCase());
  if (taken) { h.className = 'hint bad'; h.textContent = '⚠ เครื่องนี้อยู่กับ ' + taken.name +
    (taken.type === 'ครู' ? ' (ครู)' : ' (' + taken.grade + '/' + taken.room + ')'); }
  else if (FREE.some(x => x.toLowerCase() === v.toLowerCase())) { h.className = 'hint ok'; h.textContent = '✓ เครื่องว่าง พร้อมจ่าย'; }
  else { h.className = 'hint warn'; h.textContent = 'ℹ ไม่มีเลขนี้ในระบบ — จะบันทึกเป็นเครื่องใหม่'; }
}
$('#device').oninput = checkDevice;

$('#waive').onchange = e => $('#waiveChk').classList.toggle('on', e.target.checked);
$('#waiveLater').onchange = e => {
  const later = e.target.checked;
  $('#laterChk').classList.toggle('on', later);
  $('#upWaive').classList.toggle('hide', later);
  $('#waiveDocReq').classList.toggle('hide', later);
  if (later) waiveUp.reset();
};

function showErr(msg) {
  $('#errBox').innerHTML = `<div class="note err"><i class="ti ti-alert-circle"></i><div>${msg}</div></div>`;
  $('#errBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearErr() { $('#errBox').innerHTML = ''; }

$('#submit').onclick = async () => {
  clearErr();
  if (BUSY) return toast('รอรูปประมวลผลเสร็จก่อน', 'err');

  const name = $('#tname').value.trim();
  const phone = $('#tphone').value.trim();
  if (!name) return showErr('กรุณากรอกชื่อ-สกุล');
  if (!phone) return showErr('กรุณากรอกเบอร์โทรติดต่อ');
  if (!MODE) return showErr('กรุณาเลือกสถานะการรับเครื่อง');

  const p = { who: 'teacher', name, phone, mode: MODE };

  if (MODE === 'receive') {
    const dev = $('#device').value.trim();
    if (!dev) return showErr('กรุณาระบุเลขเครื่อง VPN');
    if (!photoUp.count()) return showErr('กรุณาแนบภาพถ่ายรับเครื่อง 1 รูป');
    if (conUp.count() < 2) return showErr('กรุณาแนบภาพสัญญา 2–3 หน้า');
    if (!$('#recvDate').value) return showErr('กรุณาระบุวันที่รับเครื่อง');
    p.device = dev;
    p.photo = photoUp.getValue();
    p.contracts = conUp.getValues();
    p.receiveDate = $('#recvDate').value;
  } else {
    if (!$('#waive').checked) return showErr('กรุณาติ๊กยืนยันการสละสิทธิ์');
    const later = $('#waiveLater').checked;
    if (!later && !waiveUp.count()) return showErr('กรุณาแนบเอกสารสละสิทธิ์ หรือติ๊ก "ส่งทีหลัง"');
    p.waiveConfirm = true;
    p.waiveReason = $('#waiveReason').value;
    p.waiveDoc = waiveUp.getValue() || '';
    p.waiveLater = later;
  }

  const btn = $('#submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลังบันทึก…';
  try {
    const r = await api('submitReceipt', p);
    showDone(name, phone, r.status);
  } catch (e) {
    showErr(e.message);
    toast('บันทึกไม่สำเร็จ', 'err');
    btn.disabled = false;
    btn.innerHTML = MODE === 'waive' ? '<i class="ti ti-ban"></i> ยืนยันสละสิทธิ์' : '<i class="ti ti-send"></i> ส่งข้อมูล';
  }
};

function showDone(name, phone, status) {
  const waive = status === 'สละสิทธิ์';
  $('#doneStamp').className = 'done-stamp' + (waive ? ' waive' : '');
  $('#doneStamp').innerHTML = waive ? '<i class="ti ti-ban"></i>' : '<i class="ti ti-check"></i>';
  $('#doneTitle').textContent = waive ? 'บันทึกการสละสิทธิ์แล้ว' : 'รับเครื่องเรียบร้อย';
  $('#doneTxt').textContent = name + ' · ' + phone + ' · สถานะ: ' + status;
  $$('.card, #btns, #paneRecv, #paneWaive').forEach(x => { if (x.id !== 'done' && !x.closest('#done')) x.classList.add('hide'); });
  $('#btns').style.display = 'none';
  $('#done').classList.remove('hide');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

boot();
