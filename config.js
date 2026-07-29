/* ============================================================
   ⚙️  ตั้งค่าที่เดียว — แก้เฉพาะบรรทัดเดียวด้านล่าง
   ============================================================
   วิธีหา URL:
   Apps Script → ทำให้ใช้งานได้ → การทำให้ใช้งานได้ใหม่
   → เว็บแอป | ดำเนินการในฐานะ: ฉัน | เข้าถึง: ทุกคน
   → คัดลอก URL ที่ลงท้ายด้วย /exec (ไม่ใช่ /dev)
============================================================ */

const API_URL = 'PASTE_YOUR_GAS_WEB_APP_URL_HERE';


/* ===== ห้ามแก้ใต้บรรทัดนี้ ===== */
const CFG = { ok: false, reason: '' };
(function () {
  const u = String(API_URL || '').trim();
  if (!u || u === 'PASTE_YOUR_GAS_WEB_APP_URL_HERE') CFG.reason = 'ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js';
  else if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u))
    CFG.reason = u.endsWith('/dev')
      ? 'API_URL ลงท้ายด้วย /dev — ต้องใช้ URL ที่ลงท้ายด้วย /exec'
      : 'รูปแบบ API_URL ไม่ถูกต้อง ต้องเป็น https://script.google.com/macros/s/.../exec';
  else CFG.ok = true;
})();

/** เรียก GAS API — text/plain กัน CORS preflight */
async function api(action, payload) {
  if (!CFG.ok) throw new Error(CFG.reason);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, payload: payload || {} }),
      redirect: 'follow'
    });
  } catch (e) { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตหรือ API_URL'); }
  if (res.status === 405) throw new Error('เซิร์ฟเวอร์ปฏิเสธ (405) — ตรวจว่า deploy แบบ "เข้าถึง: ทุกคน" และใช้ URL /exec');
  if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดพลาด (' + res.status + ')');
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); }
  catch (e) {
    if (text.indexOf('<!DOCTYPE') === 0 || text.indexOf('<html') > -1)
      throw new Error('ได้รับหน้า HTML แทน JSON — มัก deploy ไม่ได้ตั้ง "เข้าถึง: ทุกคน"');
    throw new Error('อ่านคำตอบจากเซิร์ฟเวอร์ไม่ได้');
  }
  if (!out.ok) throw new Error(out.error || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ');
  return out.data;
}

/** แถบเตือนถ้ายังไม่ตั้งค่า */
function guardConfig() {
  if (CFG.ok) return true;
  const b = document.createElement('div');
  b.className = 'guard';
  b.innerHTML =
    '<div class="guard-box">' +
      '<span class="stamp-mark">⚠ ยังไม่พร้อม</span>' +
      '<h2>ระบบยังตั้งค่าไม่เสร็จ</h2>' +
      '<p>' + CFG.reason + '</p>' +
      '<div class="guard-code">เปิดไฟล์ <b>config.js</b><br>แก้บรรทัด<br><br>' +
        "const API_URL = <span class='rm'>'PASTE_YOUR_GAS_WEB_APP_URL_HERE'</span>;<br><br>" +
        "เป็น URL จริงจาก Apps Script (ลงท้าย <span class='ad'>/exec</span>)</div>" +
    '</div>';
  document.body.appendChild(b);
  return false;
}

/* ---------- shared helpers (ใช้ทุกหน้า) ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function toast(msg, kind) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = 'toast', 2600);
}

/** พ.ศ. + เดือนไทย จาก yyyy-mm-dd */
function thaiDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + (Number(m[1]) + 543);
}

function todayISO() {
  const t = new Date();
  const p = n => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

/** ย่อรูป + คืน dataURL jpeg */
function compressImage(file, maxW, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => rej(new Error('อ่านไฟล์ภาพไม่สำเร็จ'));
    img.src = URL.createObjectURL(file);
  });
}

/** อ่านไฟล์พร้อม callback ความคืบหน้า (0-100) */
function readProgress(file, onProgress) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total * 100); };
    fr.onload = () => res();
    fr.onerror = () => rej(new Error('อ่านไฟล์ไม่สำเร็จ'));
    fr.readAsArrayBuffer(file);
  });
}

/** วงแหวน % ในกล่องอัปโหลด */
function setRing(box, pct) {
  const ring = box.querySelector('.ring');
  if (!ring) return;
  ring.querySelector('.fg').style.strokeDashoffset = String(113 - 113 * pct / 100);
  ring.querySelector('b').textContent = Math.round(pct) + '%';
}
