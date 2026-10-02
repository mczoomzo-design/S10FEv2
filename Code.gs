/**
 * ระบบรับ-คืนเครื่อง Samsung S10 FE — JSON API (เขียนใหม่ v3)
 * โรงเรียนเลยอนุกูลวิทยา
 *
 * สถาปัตยกรรม: GitHub Pages (เว็บ) → doPost() → Google Sheets + Drive
 * ไฟล์นี้อยู่ใน Apps Script เท่านั้น
 *
 * หลักการ:
 *  - อ่าน/เขียน Records ด้วย "ชื่อหัวคอลัมน์" ไม่ใช่ตำแหน่งตายตัว → ทนการเพิ่มคอลัมน์
 *  - ไม่ต้องตั้งค่า Script Properties เอง (ชีตใช้ getActiveSpreadsheet, โฟลเดอร์สร้างอัตโนมัติ)
 *  - ทุกการเขียนใช้ LockService กันชนกัน
 */

// ---------- ค่าคงที่ ----------
const SH = { STUDENTS: 'Students', TEACHERS: 'Teachers', DEVICES: 'Devices', RECORDS: 'Records' };
const ST = { BORROWED: 'กำลังยืม', RETURNED: 'คืนแล้ว', WAIVED: 'สละสิทธิ์' };
const TYPE = { STUDENT: 'นักเรียน', TEACHER: 'ครู' };
const TZ = 'Asia/Bangkok';

const REC_HEADERS = [
  'Timestamp', 'ประเภท', 'ชั้น', 'ห้อง', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'เบอร์โทร', 'ครูที่ปรึกษา',
  'เลขเครื่อง', 'สถานะ', 'วันที่รับ', 'ลิงก์ภาพรับเครื่อง', 'ลิงก์ภาพสัญญา',
  'วันที่คืน', 'สภาพเครื่อง', 'รายการชำรุด', 'หมายเหตุ', 'ลิงก์ภาพคืนเครื่อง',
  'ผู้รับคืน', 'เหตุผลสละสิทธิ์', 'ลิงก์เอกสารสละสิทธิ์'
];

const SHEET_DEFS = {
  Students: ['ชั้น', 'ห้อง', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'ครูที่ปรึกษา'],
  Teachers: ['ชื่อครู', 'ชั้น', 'ห้อง', 'token', 'สถานะ'],
  Devices:  ['เลขเครื่อง', 'หมายเหตุ'],
  Records:  REC_HEADERS
};

const REQUIRED_HEADERS = {
  Students: ['ชั้น', 'ห้อง', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'ครูที่ปรึกษา'],
  Teachers: ['ชื่อครู', 'ชั้น', 'ห้อง', 'token', 'สถานะ'],
  Devices:  ['เลขเครื่อง'],
  Records:  ['ประเภท', 'ชั้น', 'ห้อง', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'สถานะ']
};

// ---------- Entry points ----------

function doGet() {
  return json({ ok: true, data: { service: 'S10FE API', version: '3.0', time: new Date().toISOString() } });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents)
      return json({ ok: false, error: 'ไม่พบข้อมูลที่ส่งมา' });
    return json(handle(JSON.parse(e.postData.contents)));
  } catch (err) {
    return json({ ok: false, error: errMsg(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errMsg(err) { return String(err && err.message || err); }

function handle(body) {
  try {
    const p = body.payload || {};
    const routes = {
      ping:                () => ({ pong: true }),
      bootstrap:           () => apiBootstrap(),
      getStudents:         () => apiGetStudents(p),
      getDevices:          () => apiGetDevices(),
      submitReceipt:       () => apiSubmitReceipt(p),
      verifyToken:         () => apiVerifyToken(p),
      getClassRoster:      () => apiGetClassRoster(p),
      submitReturn:        () => apiSubmitReturn(p),
      adminLogin:          () => apiAdminLogin(p),
      adminSummary:        () => apiAdminSummary(p),
      adminRecords:        () => apiAdminRecords(p),
      adminReturn:         () => apiAdminReturn(p),
      adminServiceDevice:  () => apiAdminServiceDevice(p),
      adminAttachWaiveDoc: () => apiAdminAttachWaiveDoc(p),
      adminIssueToken:     () => apiAdminIssueToken(p),
      adminGetSettings:    () => apiAdminGetSettings(p),
      adminSaveSettings:   () => apiAdminSaveSettings(p)
    };
    const fn = routes[body.action];
    if (!fn) throw new Error('ไม่รู้จักคำสั่ง: ' + body.action);
    return { ok: true, data: fn() };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

// ---------- Spreadsheet helpers ----------

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

/** อ่านชีตทั้งแผ่นเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคอลัมน์ + ตรวจหัวคอลัมน์ */
function sheetRows(name) {
  const sh = ss().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต: ' + name + ' — กรุณารัน setupSheets');
  const values = sh.getDataRange().getValues();
  if (values.length < 1) return [];
  const head = values[0].map(h => String(h).trim());

  const need = REQUIRED_HEADERS[name];
  if (need) {
    const miss = need.filter(h => head.indexOf(h) === -1);
    if (miss.length) {
      const oldCol = (miss.indexOf('รหัสนักเรียน') > -1 && head.indexOf('เลขที่') > -1)
        ? ' — ชีตนี้ยังใช้หัวเก่า "เลขที่" ให้แก้เป็น "รหัสนักเรียน" หรือรัน setupSheets ใหม่'
        : ' — กรุณารัน setupSheets หรือแก้หัวคอลัมน์ให้ตรง';
      throw new Error('ชีต ' + name + ' ขาดคอลัมน์: ' + miss.join(', ') + oldCol);
    }
  }
  return values.slice(1)
    .filter(r => String(r[0]).trim() !== '')
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
}

/** เลขคอลัมน์ (1-indexed) จากชื่อหัวใน Records */
function recCol(name) {
  const sh = ss().getSheetByName(SH.RECORDS);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const i = head.indexOf(name);
  if (i === -1) throw new Error('ไม่พบคอลัมน์ ' + name + ' ในชีต Records');
  return i + 1;
}

function fmtDate(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) === '[object Date]')
    return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  return String(d);
}

/** เรียงรหัสแบบธรรมชาติ: 2<10<12345 ; S2<S102<S1001 ; ม4-1<ม4-2<ม4-10 */
function naturalCmp(a, b) {
  const x = String(a).trim(), y = String(b).trim();
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y);
  const rx = /(\d+|\D+)/g;
  const ax = x.match(rx) || [], ay = y.match(rx) || [];
  for (let i = 0; i < Math.max(ax.length, ay.length); i++) {
    const p = ax[i], q = ay[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (/^\d+$/.test(p) && /^\d+$/.test(q)) {
      const d = Number(p) - Number(q); if (d) return d;
    } else {
      const c = p.localeCompare(q, 'th'); if (c) return c;
    }
  }
  return 0;
}

function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

// ---------- Drive ----------

function rootFolder() {
  const saved = prop('ROOT_FOLDER_ID');
  if (saved) {
    try {
      const f = DriveApp.getFolderById(saved);
      // แชร์ครั้งเดียว/ครั้งแรกที่เข้าถึง (กัน error กรณีไม่ใช่เจ้าของ)
      if (prop('FOLDER_SHARED') !== '1') {
        try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); setProp('FOLDER_SHARED', '1'); } catch (e) {}
      }
      return f;
    }
    catch (e) {
      throw new Error('เปิดโฟลเดอร์เก็บรูปไม่ได้ — ตรวจว่าแชร์ให้บัญชีนี้เป็น "ผู้แก้ไข" '
        + 'หรือ ID ถูกต้อง (แก้ในหน้า admin → ตั้งค่าระบบ)');
    }
  }
  const name = 'S10FE - รูปภาพระบบรับคืนเครื่อง';
  const it = DriveApp.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  // แชร์โฟลเดอร์แม่ครั้งเดียว (แทนการแชร์ทีละไฟล์) — ไฟล์ข้างในดูได้ผ่านลิงก์
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); setProp('FOLDER_SHARED', '1'); } catch (e) {}
  setProp('ROOT_FOLDER_ID', f.getId());
  return f;
}

function subFolder(parent, name) {
  const it = parent.getFoldersByName(String(name));
  return it.hasNext() ? it.next() : parent.createFolder(String(name));
}

/** บันทึกรูปจาก data URL ลงโฟลเดอร์ตาม path (array), คืน URL สาธารณะ */
/** หาโฟลเดอร์ปลายทางตาม path (array) — คืน Folder object */
function resolveFolder(path) {
  let folder = rootFolder();
  path.forEach(seg => { folder = subFolder(folder, seg); });
  return folder;
}

/** แปลง data URL เป็น blob */
function dataUrlToBlob(dataUrl, filename) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename);
}

/** บันทึกรูปเดียว ลงโฟลเดอร์ที่ resolve แล้ว — คืน URL */
function saveToFolder(folder, dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl, filename);
  if (!blob) return '';
  return folder.createFile(blob).getUrl();
}

/**
 * บันทึกรูปจาก data URL ลงโฟลเดอร์ตาม path (array), คืน URL
 * เก็บไว้เพื่อ backward-compat — resolve โฟลเดอร์ทุกครั้ง (ใช้กับรูปเดี่ยว)
 */
function saveImage(dataUrl, path, filename) {
  if (!dataUrl) return '';
  const blob = dataUrlToBlob(dataUrl, filename);
  if (!blob) return '';
  return resolveFolder(path).createFile(blob).getUrl();
}

/** ทดสอบว่าเขียนโฟลเดอร์ได้จริง (จับ Viewer-vs-Editor) */
function testFolderWritable(id) {
  let f;
  try { f = DriveApp.getFolderById(id); }
  catch (e) { throw new Error('ไม่พบโฟลเดอร์ หรือบัญชีนี้ยังไม่มีสิทธิ์เข้าถึง'); }
  let tmp;
  try { tmp = f.createFile('__ทดสอบสิทธิ์เขียน__.txt', 'test', MimeType.PLAIN_TEXT); }
  catch (e) { throw new Error('เข้าถึงได้ แต่เขียนไฟล์ไม่ได้ — ต้องแชร์เป็น "ผู้แก้ไข (Editor)"'); }
  try { tmp.setTrashed(true); } catch (e) {}
  return f;
}

/** โฟลเดอร์ปลายทางของ record หนึ่ง */
function recordPath(type, grade, room, no, name) {
  if (type === TYPE.TEACHER) return ['ครู', String(name).trim()];
  return [String(grade), 'ห้อง ' + String(room), 'รหัส ' + String(no) + ' - ' + String(name)];
}

// ---------- Public API: ฟอร์มรับเครื่อง ----------

function apiBootstrap() {
  const tree = {};
  sheetRows(SH.STUDENTS).forEach(s => {
    const g = String(s['ชั้น']).trim(), r = String(s['ห้อง']).trim();
    if (!g || !r) return;
    (tree[g] = tree[g] || {})[r] = true;
  });
  return {
    grades: Object.keys(tree).sort(naturalCmp).map(g => ({
      grade: g,
      rooms: Object.keys(tree[g]).sort(naturalCmp)
    }))
  };
}

function apiGetStudents(p) {
  const grade = String(p.grade).trim(), room = String(p.room).trim();
  const taken = {};
  sheetRows(SH.RECORDS).forEach(r => {
    if (String(r['ประเภท']) === TYPE.STUDENT && String(r['สถานะ']) !== ST.RETURNED)
      taken[[r['ชั้น'], r['ห้อง'], r['รหัสนักเรียน']].join('|')] = String(r['สถานะ']);
  });
  return {
    students: sheetRows(SH.STUDENTS)
      .filter(s => String(s['ชั้น']).trim() === grade && String(s['ห้อง']).trim() === room)
      .map(s => {
        const no = String(s['รหัสนักเรียน']).trim();
        return {
          no: no,
          name: String(s['ชื่อ-สกุล']).trim(),
          teacher: String(s['ครูที่ปรึกษา']).trim(),
          done: taken[[grade, room, no].join('|')] || ''
        };
      })
      .sort((a, b) => naturalCmp(a.no, b.no))
  };
}

/** เครื่องว่าง + เครื่องที่ถูกยืม (พร้อมชื่อผู้ยืม) สำหรับ datalist และเตือนสด */
function apiGetDevices() {
  const usedList = [], usedSet = {};
  sheetRows(SH.RECORDS).forEach(r => {
    if (String(r['สถานะ']) !== ST.BORROWED) return;
    const dev = String(r['เลขเครื่อง']).trim();
    if (!dev) return;
    usedSet[dev.toLowerCase()] = true;
    usedList.push({
      device: dev,
      name: String(r['ชื่อ-สกุล']),
      type: String(r['ประเภท'] || TYPE.STUDENT),
      grade: String(r['ชั้น']),
      room: String(r['ห้อง'])
    });
  });
  const damaged = damagedDevices(sheetRows(SH.RECORDS));
  const free = sheetRows(SH.DEVICES)
    .map(d => String(d['เลขเครื่อง']).trim())
    .filter(d => d && !usedSet[d.toLowerCase()] && !damaged[norm(d)]);
  return { free: free, used: usedList };
}

function apiSubmitReceipt(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss().getSheetByName(SH.RECORDS);
    const recs = sheetRows(SH.RECORDS);
    const isTeacher = p.who === 'teacher';
    const name = String(p.name || '').trim();
    if (!name) throw new Error('กรุณากรอกชื่อ-สกุล');

    // กันซ้ำ
    if (isTeacher) {
      const phone = String(p.phone || '').trim();
      const dup = recs.find(r =>
        String(r['ประเภท']) === TYPE.TEACHER &&
        String(r['ชื่อ-สกุล']).trim() === name &&
        String(r['เบอร์โทร']).trim() === phone &&
        String(r['สถานะ']) !== ST.RETURNED);
      if (dup) throw new Error('ครู "' + name + '" บันทึกไว้แล้ว (สถานะ: ' + dup['สถานะ'] + ')');
    } else {
      const dup = recs.find(r =>
        String(r['ประเภท']) !== TYPE.TEACHER &&
        String(r['ชั้น']) === p.grade && String(r['ห้อง']) === p.room &&
        String(r['รหัสนักเรียน']) === p.no && String(r['สถานะ']) !== ST.RETURNED);
      if (dup) throw new Error('นักเรียนคนนี้บันทึกไว้แล้ว (สถานะ: ' + dup['สถานะ'] + ')');
    }

    const path = recordPath(isTeacher ? TYPE.TEACHER : TYPE.STUDENT,
      p.grade, p.room, p.no, isTeacher ? name : (p.no + ' - ' + name));
    // นักเรียนใช้ path มาตรฐาน; ปรับ path ครูให้เป็น ['ครู', name]
    const folderPath = isTeacher ? ['ครู', name] : [String(p.grade), 'ห้อง ' + String(p.room), 'รหัส ' + p.no + ' - ' + name];

    let device = '', status = ST.WAIVED, recvDate = '';
    let devUrl = '', conUrls = [], waiveUrl = '';

    if (p.mode === 'receive') {
      device = String(p.device || '').trim();
      if (!device) throw new Error('กรุณาระบุเลขเครื่อง');
      if (damagedDevices(recs)[norm(device)]) throw new Error('เครื่องนี้ถูกแจ้งชำรุด ยังไม่พร้อมจ่าย');
      const clash = recs.find(r =>
        norm(r['เลขเครื่อง']) === device.toLowerCase() && String(r['สถานะ']) === ST.BORROWED);
      if (clash) throw new Error('เลขเครื่อง ' + device + ' ถูกจ่ายให้ ' + clash['ชื่อ-สกุล']
        + (String(clash['ประเภท']) === TYPE.TEACHER ? ' (ครู)' : ' (' + clash['ชั้น'] + '/' + clash['ห้อง'] + ')') + ' แล้ว');
      if (!p.photo) throw new Error('กรุณาแนบภาพถ่ายรับเครื่อง');
      if (!p.contracts || p.contracts.length < 2) throw new Error('กรุณาแนบภาพสัญญาอย่างน้อย 2 หน้า');
      if (!p.receiveDate) throw new Error('กรุณาระบุวันที่รับเครื่อง');
      const folder = resolveFolder(folderPath);
      devUrl = saveToFolder(folder, p.photo, 'รับเครื่อง.jpg');
      conUrls = p.contracts.map((c, i) => saveToFolder(folder, c, 'สัญญา-' + (i + 1) + '.jpg'));
      recvDate = p.receiveDate;
      status = ST.BORROWED;
    } else {
      if (!p.waiveConfirm) throw new Error('กรุณายืนยันการสละสิทธิ์');
      if (!p.waiveLater) {
        if (!p.waiveDoc) throw new Error('กรุณาแนบเอกสารสละสิทธิ์ 1 หน้า');
        waiveUrl = saveImage(p.waiveDoc, folderPath, 'เอกสารสละสิทธิ์.jpg');
      }
    }

    const rowObj = {
      'Timestamp': new Date(),
      'ประเภท': isTeacher ? TYPE.TEACHER : TYPE.STUDENT,
      'ชั้น': isTeacher ? 'ครู' : p.grade,
      'ห้อง': isTeacher ? '' : p.room,
      'รหัสนักเรียน': isTeacher ? '' : p.no,
      'ชื่อ-สกุล': name,
      'เบอร์โทร': isTeacher ? String(p.phone || '') : '',
      'ครูที่ปรึกษา': isTeacher ? '' : String(p.teacher || ''),
      'เลขเครื่อง': device,
      'สถานะ': status,
      'วันที่รับ': recvDate,
      'ลิงก์ภาพรับเครื่อง': devUrl,
      'ลิงก์ภาพสัญญา': conUrls.join('\n'),
      'เหตุผลสละสิทธิ์': p.mode === 'receive' ? '' : String(p.waiveReason || ''),
      'ลิงก์เอกสารสละสิทธิ์': waiveUrl
    };
    appendRecord(sh, rowObj);
    return { status: status };
  } finally {
    lock.releaseLock();
  }
}

/** เขียนแถวใหม่ตามลำดับหัวคอลัมน์จริง (ทนการสลับ/เพิ่มคอลัมน์) */
function appendRecord(sh, obj) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const row = head.map(h => (h in obj) ? obj[h] : '');
  sh.appendRow(row);
}

// ---------- Public API: token ครูที่ปรึกษา + คืนเครื่อง ----------

function apiVerifyToken(p) {
  const tk = String(p.token || '').trim().toUpperCase();
  if (!tk) throw new Error('ไม่พบ token');
  const t = sheetRows(SH.TEACHERS).find(x =>
    String(x['token']).trim().toUpperCase() === tk && String(x['สถานะ']).trim() === 'ใช้งาน');
  if (!t) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ ติดต่อผู้ดูแลระบบ');
  return { teacher: String(t['ชื่อครู']).trim(), grade: String(t['ชั้น']).trim(), room: String(t['ห้อง']).trim() };
}

function apiGetClassRoster(p) {
  const t = apiVerifyToken(p);
  return {
    teacher: t,
    rows: sheetRows(SH.RECORDS)
      .map((r, i) => ({ r: r, row: i + 2 }))
      .filter(x => String(x.r['ประเภท']) !== TYPE.TEACHER &&
                   String(x.r['ชั้น']) === t.grade && String(x.r['ห้อง']) === t.room)
      .map(x => ({
        row: x.row,
        no: String(x.r['รหัสนักเรียน']),
        name: String(x.r['ชื่อ-สกุล']),
        device: String(x.r['เลขเครื่อง']),
        status: String(x.r['สถานะ']),
        receiveDate: fmtDate(x.r['วันที่รับ']),
        returnDate: fmtDate(x.r['วันที่คืน']),
        condition: String(x.r['สภาพเครื่อง'] || '')
      }))
      .sort((a, b) => naturalCmp(a.no, b.no))
  };
}

/** ตรรกะคืนเครื่องกลาง — ใช้ทั้งครูที่ปรึกษาและ admin */
function doReturn(p, receiver) {
  const sh = ss().getSheetByName(SH.RECORDS);
  const row = Number(p.row);
  if (!row || row < 2) throw new Error('แถวข้อมูลไม่ถูกต้อง');

  const cStatus = recCol('สถานะ');
  if (String(sh.getRange(row, cStatus).getValue()) !== ST.BORROWED)
    throw new Error('รายการนี้ไม่ได้อยู่ในสถานะกำลังยืม');

  const cond = String(p.condition || '');
  if (['ปกติ', 'ชำรุด', 'สูญหาย'].indexOf(cond) === -1) throw new Error('กรุณาเลือกสภาพเครื่อง');
  if (!p.returnDate) throw new Error('กรุณาระบุวันที่คืน');

  let damage = '';
  if (cond === 'ชำรุด') {
    const list = p.damage || [];
    if (!list.length) throw new Error('กรุณาติ๊กรายการชำรุดอย่างน้อย 1 รายการ');
    if (!p.photo) throw new Error('กรณีชำรุด ต้องแนบภาพถ่ายตอนคืน');
    damage = list.join(', ');
  }
  if (cond === 'สูญหาย' && !String(p.note || '').trim())
    throw new Error('กรณีสูญหาย ต้องกรอกหมายเหตุ');

  let url = '';
  if (p.photo) {
    const type = String(sh.getRange(row, recCol('ประเภท')).getValue());
    const name = String(sh.getRange(row, recCol('ชื่อ-สกุล')).getValue());
    const grade = String(sh.getRange(row, recCol('ชั้น')).getValue());
    const room = String(sh.getRange(row, recCol('ห้อง')).getValue());
    const no = String(sh.getRange(row, recCol('รหัสนักเรียน')).getValue());
    const path = type === TYPE.TEACHER ? ['ครู', name] : [grade, 'ห้อง ' + room, 'รหัส ' + no + ' - ' + name];
    url = saveImage(p.photo, path, 'คืนเครื่อง.jpg');
  }

  sh.getRange(row, cStatus).setValue(ST.RETURNED);
  sh.getRange(row, recCol('วันที่คืน')).setValue(p.returnDate);
  sh.getRange(row, recCol('สภาพเครื่อง')).setValue(cond);
  sh.getRange(row, recCol('รายการชำรุด')).setValue(damage);
  sh.getRange(row, recCol('หมายเหตุ')).setValue(String(p.note || ''));
  sh.getRange(row, recCol('ลิงก์ภาพคืนเครื่อง')).setValue(url);
  sh.getRange(row, recCol('ผู้รับคืน')).setValue(receiver);
  return { ok: true };
}

function apiSubmitReturn(p) {
  const t = apiVerifyToken(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss().getSheetByName(SH.RECORDS);
    const row = Number(p.row);
    const g = String(sh.getRange(row, recCol('ชั้น')).getValue());
    const r = String(sh.getRange(row, recCol('ห้อง')).getValue());
    if (g !== t.grade || r !== t.room) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลห้องอื่น');
    return doReturn(p, t.teacher);
  } finally {
    lock.releaseLock();
  }
}

// ---------- Admin ----------

function apiAdminLogin(p) {
  if (String(p.user).trim() !== prop('ADMIN_USER') || String(p.pass).trim() !== prop('ADMIN_PASS'))
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  const key = Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + key, '1', 21600);
  return { session: key };
}

// ตัดการบังคับล็อกอินออกแล้ว (ตามคำขอ) — เข้าหน้า admin ได้ทันทีไม่ต้องใส่รหัส
// ผู้ที่มีลิงก์ admin.html จะเข้าถึง/แก้ไขข้อมูลได้ทั้งหมด
function requireAdmin(p) {}

function apiAdminSummary(p) {
  requireAdmin(p);
  const rooms = {};
  sheetRows(SH.STUDENTS).forEach(s => {
    const k = String(s['ชั้น']) + '|' + String(s['ห้อง']);
    if (!rooms[k]) rooms[k] = { grade: String(s['ชั้น']), room: String(s['ห้อง']),
      total: 0, borrowed: 0, returned: 0, waived: 0, pending: 0, damaged: 0, lost: 0 };
    rooms[k].total++;
  });
  let teacher = { total: 0, borrowed: 0, returned: 0, waived: 0, damaged: 0, lost: 0 };
  sheetRows(SH.RECORDS).forEach(r => {
    const st = String(r['สถานะ']), cond = String(r['สภาพเครื่อง']);
    if (String(r['ประเภท']) === TYPE.TEACHER) {
      teacher.total++;
      if (st === ST.BORROWED) teacher.borrowed++;
      if (st === ST.RETURNED) teacher.returned++;
      if (st === ST.WAIVED) teacher.waived++;
      if (cond === 'ชำรุด') teacher.damaged++;
      if (cond === 'สูญหาย') teacher.lost++;
      return;
    }
    const k = String(r['ชั้น']) + '|' + String(r['ห้อง']);
    if (!rooms[k]) return;
    if (st === ST.BORROWED) rooms[k].borrowed++;
    if (st === ST.RETURNED) rooms[k].returned++;
    if (st === ST.WAIVED) rooms[k].waived++;
    if (cond === 'ชำรุด') rooms[k].damaged++;
    if (cond === 'สูญหาย') rooms[k].lost++;
  });
  const list = Object.keys(rooms).map(k => {
    const m = rooms[k];
    m.pending = m.total - m.borrowed - m.returned - m.waived;
    return m;
  }).sort((a, b) => naturalCmp(a.grade, b.grade) || naturalCmp(a.room, b.room));

  const totals = list.reduce((a, m) => ({
    total: a.total + m.total, borrowed: a.borrowed + m.borrowed, returned: a.returned + m.returned,
    waived: a.waived + m.waived, pending: a.pending + m.pending, damaged: a.damaged + m.damaged, lost: a.lost + m.lost
  }), { total: 0, borrowed: 0, returned: 0, waived: 0, pending: 0, damaged: 0, lost: 0 });

  return { rooms: list, totals: totals, teacher: teacher };
}

function apiAdminRecords(p) {
  requireAdmin(p);
  return {
    rows: sheetRows(SH.RECORDS).map((r, i) => ({
      row: i + 2,
      ts: fmtDate(r['Timestamp']),
      type: String(r['ประเภท'] || TYPE.STUDENT),
      grade: String(r['ชั้น']), room: String(r['ห้อง']),
      no: String(r['รหัสนักเรียน']), name: String(r['ชื่อ-สกุล']),
      phone: String(r['เบอร์โทร'] || ''),
      teacher: String(r['ครูที่ปรึกษา']), device: String(r['เลขเครื่อง']),
      status: String(r['สถานะ']),
      receiveDate: fmtDate(r['วันที่รับ']),
      photo: String(r['ลิงก์ภาพรับเครื่อง'] || ''),
      contracts: String(r['ลิงก์ภาพสัญญา'] || ''),
      returnDate: fmtDate(r['วันที่คืน']),
      condition: String(r['สภาพเครื่อง'] || ''),
      damage: String(r['รายการชำรุด'] || ''),
      serviceHistory: readServiceHistory(r['ประวัติชำรุดและเปลี่ยนเครื่อง']),
      note: String(r['หมายเหตุ'] || ''),
      returnPhoto: String(r['ลิงก์ภาพคืนเครื่อง'] || ''),
      receiver: String(r['ผู้รับคืน'] || ''),
      waiveReason: String(r['เหตุผลสละสิทธิ์'] || ''),
      waiveDoc: String(r['ลิงก์เอกสารสละสิทธิ์'] || '')
    }))
  };
}

function apiAdminReturn(p) {
  requireAdmin(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return doReturn(p, 'ผู้ดูแลระบบ'); }
  finally { lock.releaseLock(); }
}

function apiAdminAttachWaiveDoc(p) {
  requireAdmin(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss().getSheetByName(SH.RECORDS);
    const row = Number(p.row);
    if (!row || row < 2) throw new Error('แถวข้อมูลไม่ถูกต้อง');
    if (!p.doc) throw new Error('ไม่พบไฟล์เอกสาร');
    if (String(sh.getRange(row, recCol('สถานะ')).getValue()) !== ST.WAIVED)
      throw new Error('รายการนี้ไม่ใช่สถานะสละสิทธิ์');

    const type = String(sh.getRange(row, recCol('ประเภท')).getValue());
    const name = String(sh.getRange(row, recCol('ชื่อ-สกุล')).getValue());
    const grade = String(sh.getRange(row, recCol('ชั้น')).getValue());
    const room = String(sh.getRange(row, recCol('ห้อง')).getValue());
    const no = String(sh.getRange(row, recCol('รหัสนักเรียน')).getValue());
    const path = type === TYPE.TEACHER ? ['ครู', name] : [grade, 'ห้อง ' + room, 'รหัส ' + no + ' - ' + name];

    const url = saveImage(p.doc, path, 'เอกสารสละสิทธิ์.jpg');
    sh.getRange(row, recCol('ลิงก์เอกสารสละสิทธิ์')).setValue(url);
    return { ok: true, url: url };
  } finally {
    lock.releaseLock();
  }
}

function apiAdminIssueToken(p) {
  requireAdmin(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss().getSheetByName(SH.TEACHERS);
    const v = sh.getDataRange().getValues();
    const tk = randToken();
    for (let i = 1; i < v.length; i++) {
      if (String(v[i][1]).trim() === String(p.grade) && String(v[i][2]).trim() === String(p.room)) {
        sh.getRange(i + 1, 4).setValue(tk);
        sh.getRange(i + 1, 5).setValue('ใช้งาน');
        const base = (prop('SITE_URL') || '').replace(/\/+$/, '');
        return { token: tk, url: base ? base + '/return.html?token=' + tk : '', needSiteUrl: !base };
      }
    }
    throw new Error('ไม่พบครูที่ปรึกษาของ ' + p.grade + '/' + p.room + ' ในชีต Teachers');
  } finally {
    lock.releaseLock();
  }
}

function apiAdminGetSettings(p) {
  requireAdmin(p);
  let folderUrl = '', folderName = '', folderOwner = '', folderErr = '';
  try {
    const f = rootFolder();
    folderUrl = f.getUrl(); folderName = f.getName();
    try { folderOwner = f.getOwner().getEmail(); } catch (e) { folderOwner = '(ไม่ทราบ)'; }
  } catch (e) { folderErr = errMsg(e); }
  return {
    siteUrl: prop('SITE_URL') || '',
    adminUser: prop('ADMIN_USER') || 'admin',
    folderId: prop('ROOT_FOLDER_ID') || '',
    folderUrl: folderUrl, folderName: folderName, folderOwner: folderOwner, folderErr: folderErr,
    scriptAccount: Session.getEffectiveUser().getEmail()
  };
}

function apiAdminSaveSettings(p) {
  requireAdmin(p);
  if (p.siteUrl !== undefined) {
    const u = String(p.siteUrl).trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('URL เว็บไซต์ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://');
    setProp('SITE_URL', u);
  }
  if (p.folderId !== undefined && String(p.folderId).trim()) {
    const m = String(p.folderId).trim().match(/[-\w]{25,}/);
    if (!m) throw new Error('ID โฟลเดอร์ไม่ถูกต้อง');
    testFolderWritable(m[0]);
    setProp('ROOT_FOLDER_ID', m[0]);
  }
  if (p.newPass !== undefined && String(p.newPass).trim()) {
    if (String(p.newPass).trim().length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    setProp('ADMIN_PASS', String(p.newPass).trim());
  }
  return { ok: true };
}

// ---------- Setup / เมนู ----------

function randToken() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

function setupSheets() {
  const s = ss();
  Object.keys(SHEET_DEFS).forEach(name => {
    const sh = s.getSheetByName(name) || s.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, SHEET_DEFS[name].length).setValues([SHEET_DEFS[name]])
      .setFontWeight('bold').setBackground('#0f2f4f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  // ตัวอย่าง (ลบทิ้งได้)
  s.getSheetByName('Students').getRange(2, 1, 2, 5).setValues([
    ['ม.4', '1', '12345', 'ตัวอย่าง ชื่อนักเรียน', 'ตัวอย่าง ครูที่ปรึกษา'],
    ['ม.4', '1', '12346', 'ลบ 2 แถวนี้ทิ้งได้', 'ตัวอย่าง ครูที่ปรึกษา']
  ]);
  s.getSheetByName('Teachers').getRange(2, 1, 1, 5)
    .setValues([['ตัวอย่าง ครูที่ปรึกษา', 'ม.4', '1', '', 'ใช้งาน']]);
  s.getSheetByName('Devices').getRange(2, 1, 2, 2)
    .setValues([['LAK-S10-0001', 'ลบแถวตัวอย่างทิ้งได้'], ['LAK-S10-0002', '']]);

  if (!prop('ADMIN_USER')) setProp('ADMIN_USER', 'admin');
  let pass = prop('ADMIN_PASS');
  if (!pass) { pass = randToken() + randToken().slice(0, 4); setProp('ADMIN_PASS', pass); }

  let folderUrl = '(สร้างไม่สำเร็จ)';
  try { folderUrl = rootFolder().getUrl(); } catch (e) { folderUrl = 'ผิดพลาด: ' + errMsg(e); }

  const NL = String.fromCharCode(10);
  const msg = [
    '✅ ติดตั้งเรียบร้อย — ไม่ต้องตั้งค่าอะไรเพิ่มใน Apps Script', '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '🔑 รหัสผ่านผู้ดูแล (บันทึกไว้)',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    'ชื่อผู้ใช้: admin',
    'รหัสผ่าน: ' + pass, '',
    '(ลืมได้ — ดูซ้ำที่เมนู ⚙️ ระบบ S10 FE → ดูรหัสผ่าน)', '',
    '📁 โฟลเดอร์เก็บรูป (สร้างให้แล้ว):',
    folderUrl, '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    'ขั้นต่อไป',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '1. กรอกชีต Students / Teachers / Devices',
    '2. Deploy → เว็บแอป → เข้าถึง: ทุกคน → คัดลอก URL',
    '3. เอา URL ไปใส่ใน config.js บน GitHub'
  ].join(NL);

  showMsg(msg);
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('⚙️ ระบบ S10 FE')
      .addItem('สร้างชีตเริ่มต้น (setupSheets)', 'setupSheets')
      .addItem('ดูรหัสผ่าน / URL ที่ตั้งไว้', 'showConfig')
      .addToUi();
  } catch (e) {}
}

function showConfig() {
  let folderUrl = '(ยังไม่สร้าง)';
  try { folderUrl = rootFolder().getUrl(); } catch (e) {}
  const NL = String.fromCharCode(10);
  showMsg([
    '🔑 ชื่อผู้ใช้: ' + (prop('ADMIN_USER') || 'admin'),
    '🔑 รหัสผ่าน: ' + (prop('ADMIN_PASS') || '(ยังไม่ได้รัน setupSheets)'), '',
    '📁 โฟลเดอร์รูป:', folderUrl, '',
    '🌐 URL เว็บไซต์: ' + (prop('SITE_URL') || '(ยังไม่ตั้ง — ตั้งในหน้า admin)')
  ].join(NL));
}

/** แสดงข้อความ — กล่องเด้งถ้ามี UI, ไม่งั้นพิมพ์ลง Logger (รันจาก Editor ได้) */
function showMsg(msg) {
  try { SpreadsheetApp.getUi().alert(msg); }
  catch (e) {
    const line = '='.repeat(50);
    Logger.log(String.fromCharCode(10) + line + String.fromCharCode(10) + msg + String.fromCharCode(10) + line);
  }
}
// ---------- แจ้งชำรุด / เปลี่ยนเครื่อง (เพิ่มคอลัมน์โดยไม่ล้างข้อมูล) ----------
function readServiceHistory(value) {
  if (!value) return [];
  const history = JSON.parse(String(value));
  if (!Array.isArray(history)) throw new Error('รูปแบบประวัติเปลี่ยนเครื่องไม่ถูกต้อง');
  return history;
}

function damagedDevices(records) {
  const damaged = {};
  records.forEach(r => {
    if (String(r['สภาพเครื่อง']) === 'ชำรุด') damaged[norm(r['เลขเครื่อง'])] = true;
    readServiceHistory(r['ประวัติชำรุดและเปลี่ยนเครื่อง']).forEach(h => {
      if (h.oldDevice) damaged[norm(h.oldDevice)] = true;
    });
  });
  return damaged;
}

function apiAdminServiceDevice(p) {
  requireAdmin(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss().getSheetByName(SH.RECORDS);
    const row = Number(p.row);
    if (!Number.isInteger(row) || row < 2 || row > sh.getLastRow()) throw new Error('แถวข้อมูลไม่ถูกต้อง');
    let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    let values = sh.getRange(row, 1, 1, head.length).getValues()[0];
    const record = {};
    head.forEach((h, i) => record[h] = values[i]);
    if (String(record['สถานะ']) !== ST.BORROWED) throw new Error('แจ้งชำรุดหรือเปลี่ยนได้เฉพาะรายการที่กำลังยืม');
    const oldDevice = String(record['เลขเครื่อง'] || '').trim();
    if (!oldDevice || oldDevice !== String(p.expectedDevice || '').trim()) throw new Error('เลขเครื่องเปลี่ยนไปแล้ว กรุณารีเฟรชข้อมูล');
    const damage = String(p.damage || '').trim();
    if (!damage || damage.length > 2000 || damage.startsWith('=')) throw new Error('กรุณาระบุอาการชำรุดไม่เกิน 2000 ตัวอักษร');
    const date = String(p.date || '');
    const parsedDate = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date)
      throw new Error('วันที่ไม่ถูกต้อง');
    const newDevice = String(p.newDevice || '').trim();
    if (newDevice.length > 100 || /^[=+@]/.test(newDevice)) throw new Error('รหัสเครื่องใหม่ไม่ถูกต้อง');
    if (newDevice) {
      if (norm(newDevice) === norm(oldDevice)) throw new Error('เครื่องใหม่ต้องต่างจากเครื่องเดิม');
      const records = sheetRows(SH.RECORDS);
      if (records.some(r => String(r['สถานะ']) === ST.BORROWED && norm(r['เลขเครื่อง']) === norm(newDevice)))
        throw new Error('เครื่องใหม่ถูกยืมอยู่แล้ว');
      if (damagedDevices(records)[norm(newDevice)]) throw new Error('เครื่องใหม่ถูกแจ้งชำรุด ยังไม่พร้อมจ่าย');
    }
    const history = readServiceHistory(record['ประวัติชำรุดและเปลี่ยนเครื่อง']);
    history.push({date, at: new Date().toISOString(), oldDevice, newDevice, damage});
    const serialized = JSON.stringify(history);
    if (serialized.length > 45000) throw new Error('ประวัติรายการนี้เต็ม กรุณาติดต่อผู้ดูแลชีต');
    // All validation completes before schema or record writes.
    const historyHeader = 'ประวัติชำรุดและเปลี่ยนเครื่อง';
    if (head.indexOf(historyHeader) === -1) {
      const col = head.length + 1;
      if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
      sh.getRange(1, col).setValue(historyHeader);
      head.push(historyHeader);
      values.push('');
    }
    const put = (name, value) => {
      const col = head.indexOf(name);
      if (col === -1) throw new Error('ไม่พบคอลัมน์ ' + name);
      values[col] = value;
    };
    put(historyHeader, serialized);
    put('สภาพเครื่อง', newDevice ? 'ปกติ' : 'ชำรุด');
    put('รายการชำรุด', newDevice ? '' : damage);
    if (newDevice) put('เลขเครื่อง', newDevice);
    const formulas = sh.getRange(row, 1, 1, head.length).getFormulas()[0];
    const changed = [historyHeader, 'สภาพเครื่อง', 'รายการชำรุด', 'เลขเครื่อง'];
    values = values.map((value, i) => formulas[i] && changed.indexOf(head[i]) === -1 ? formulas[i] : value);
    sh.getRange(row, 1, 1, head.length).setValues([values]);
    return {ok: true, device: newDevice || oldDevice, serviceHistory: history};
  } finally {
    lock.releaseLock();
  }
}
