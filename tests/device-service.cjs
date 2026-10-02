const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../Code.gs', 'utf8');
const headers = ['Timestamp','ประเภท','ชั้น','ห้อง','รหัสนักเรียน','ชื่อ-สกุล','เลขเครื่อง','สถานะ','สภาพเครื่อง','รายการชำรุด'];
let data, locks;
function reset() {
  data = [headers.slice(), ['date','นักเรียน','ม.4','1','001','Test','OLD-1','กำลังยืม','',''], ['date','นักเรียน','ม.4','1','002','Other','BUSY-1','กำลังยืม','','']];
  locks = 0;
}
const sheet = {
  getLastRow: () => data.length, getLastColumn: () => data[0].length, getMaxColumns: () => 30,
  getDataRange: () => ({getValues: () => data.map(r => r.slice())}),
  getRange(row,col,nr=1,nc=1) { return {
    getValues: () => Array.from({length:nr},(_,r)=>Array.from({length:nc},(_,c)=>data[row+r-1]?.[col+c-1] ?? '')),
    getFormulas: () => [Array(nc).fill('')],
    setValue: value => {data[row-1][col-1] = value;},
    setValues: rows => rows.forEach((values,r)=>values.forEach((v,c)=>{data[row+r-1][col+c-1]=v;}))
  }; }
};
const ctx = vm.createContext({
  SpreadsheetApp: {getActiveSpreadsheet:()=>({getSheetByName:()=>sheet})},
  LockService: {getScriptLock:()=>({waitLock(){locks++;},releaseLock(){locks--;}})}
});
vm.runInContext(source,ctx);
const payload = {row:2,expectedDevice:'OLD-1',date:'2026-10-02',damage:'จอแตก'};
const call = p => ctx.handle({action:'adminServiceDevice',payload:{...payload,...p}});
reset();
assert.equal(call({}).ok,true);
assert.equal(data[1][7],'กำลังยืม');
assert.equal(data[1][8],'ชำรุด');
assert.equal(data[1][9],'จอแตก');
assert.equal(data[2][6],'BUSY-1');
assert.equal(call({newDevice:'NEW-1'}).ok,true);
assert.equal(data[1][6],'NEW-1');
assert.equal(data[1][8],'ปกติ');
assert.equal(data[1][9],'');
let history=JSON.parse(data[1][10]);
assert.equal(history.length,2);
assert.equal(history[1].oldDevice,'OLD-1');
assert.equal(history[1].newDevice,'NEW-1');
assert.equal(ctx.apiAdminRecords({}).rows[0].serviceHistory.length,2);
assert.equal(call({expectedDevice:'NEW-1',newDevice:'OLD-1'}).ok,false);
assert.equal(call({newDevice:'NEW-2'}).ok,false); // Stale browser cannot overwrite a replacement.
for (const invalid of [{damage:''},{newDevice:'old-1'},{newDevice:'busy-1'},{date:'2026-02-30'},{row:1},{row:2.5},{row:99}]) {
  reset(); const before=JSON.stringify(data);
  assert.equal(call(invalid).ok,false,JSON.stringify(invalid));
  assert.equal(JSON.stringify(data),before,'failed validation must not mutate records');
  assert.equal(locks,0);
}
reset();data[1][7]='คืนแล้ว';assert.equal(call({}).ok,false);
assert.equal(locks,0);
console.log('PASS: damage-only, replacement, history, roster mapping, unavailable device, stale update, validation, non-destructive schema, lock release');
