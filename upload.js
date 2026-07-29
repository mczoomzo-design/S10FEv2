/* ============================================================
   upload.js — วิดเจ็ตอัปโหลดรูป (ใช้ร่วมกัน index / teacher / admin)
   สร้าง Uploader ผูกกับกล่อง .up + input[type=file]
   - single: เก็บรูปเดียว (getValue คืน dataURL หรือ null)
   - multi:  เก็บหลายรูป (getValues คืน array)
============================================================ */

function makeUploader(opts) {
  // opts: { box, bar, barText, thumbs, multi, min, max, onBusy, onChange, defaultLabel }
  const box = $(opts.box);
  const input = box.querySelector('input[type=file]');
  const bar = opts.bar ? $(opts.bar) : null;
  const barText = opts.barText ? $(opts.barText) : null;
  const thumbsEl = opts.thumbs ? $(opts.thumbs) : null;
  const multi = !!opts.multi;
  const max = opts.max || (multi ? 3 : 1);
  const defaultLabel = opts.defaultLabel || 'ถ่ายหรือเลือกไฟล์';
  let busy = false;
  const items = []; // dataURLs

  input.multiple = multi;

  input.onchange = async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || busy) return;
    for (const f of files) {
      if (items.length >= max) { toast('แนบได้สูงสุด ' + max + ' รูป', 'err'); break; }
      if (!f.type.startsWith('image/')) { toast('รองรับเฉพาะไฟล์รูปภาพ', 'err'); continue; }
      if (f.size > 12 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 12 MB', 'err'); continue; }
      await processOne(f);
    }
  };

  async function processOne(f) {
    busy = true; box.classList.add('busy'); box.classList.remove('has');
    if (opts.onBusy) opts.onBusy(true);
    if (bar) { bar.classList.remove('hide', 'done'); }
    try {
      await readProgress(f, p => {
        setRing(box, p * .7);
        if (bar) bar.querySelector('i').style.width = (p * .7) + '%';
        if (barText) barText.textContent = 'กำลังประมวลผล — ' + Math.round(p * .7) + '%';
      });
      setRing(box, 85);
      if (bar) bar.querySelector('i').style.width = '85%';
      const data = await compressImage(f, 1400, .8);
      items.push(data);
      setRing(box, 100);
      if (bar) { bar.querySelector('i').style.width = '100%'; bar.classList.add('done'); }
      if (barText) barText.textContent = 'เสร็จสิ้น';
      await new Promise(r => setTimeout(r, 260));
      render();
      if (bar) setTimeout(() => { bar.classList.add('hide'); if (barText) barText.textContent = ''; }, 650);
    } catch (err) {
      toast(err.message, 'err');
      if (bar) bar.classList.add('hide');
    } finally {
      box.classList.remove('busy'); busy = false;
      if (opts.onBusy) opts.onBusy(false);
      if (opts.onChange) opts.onChange(items.length);
    }
  }

  function render() {
    const has = items.length > 0;
    box.classList.toggle('has', has);
    const icon = box.querySelector('i');
    const span = box.querySelector('span');
    if (has) {
      icon.className = 'ti ti-circle-check';
      span.textContent = multi ? (items.length + '/' + max + ' รูป · แตะเพิ่ม') : 'แนบแล้ว · แตะเพื่อเปลี่ยน';
    } else {
      icon.className = box.dataset.icon || 'ti ti-camera';
      span.textContent = defaultLabel;
    }
    if (thumbsEl) {
      thumbsEl.innerHTML = items.map((src, i) =>
        `<div class="tw"><img class="thumb" src="${src}" alt="รูป ${i + 1}"><button data-i="${i}" aria-label="ลบ">×</button></div>`).join('');
      thumbsEl.querySelectorAll('button').forEach(b => b.onclick = ev => {
        ev.preventDefault();
        items.splice(Number(b.dataset.i), 1);
        render();
        if (opts.onChange) opts.onChange(items.length);
      });
    }
  }

  return {
    getValue: () => items[0] || null,
    getValues: () => items.slice(),
    count: () => items.length,
    isBusy: () => busy,
    reset: () => { items.length = 0; render(); }
  };
}
