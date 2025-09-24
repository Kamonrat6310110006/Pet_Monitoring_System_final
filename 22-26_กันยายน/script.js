/************************************************************
 * script.js — FULL (Alert page = per selected cat only)
 * - Alerts: สะสม, อ่านแล้วเป็นสีเทา, อ่านทั้งหมด, ลบ
 * - บังคับให้แสดงเฉพาะแมวที่เลือกจากหน้า Cat/Detail
 * - ตัดปุ่ม “ล้างตัวกรอง” ใต้หัวข้อออก (ไม่ให้สลับแมว)
 ************************************************************/

/* =========================
 * 1) CONFIG
 * ========================= */
const API_BASE = "http://localhost:5000";
const ENDPOINTS = {
  cats: `${API_BASE}/api/cats`,
  alerts: `${API_BASE}/api/alerts`,
  alertsMarkRead: `${API_BASE}/api/alerts/mark_read`,
  alertsMarkAllRead: `${API_BASE}/api/alerts/mark_all_read`,
  alertsDelete: `${API_BASE}/api/alerts/delete`,
  systemConfig: `${API_BASE}/api/system_config`,
  rooms: `${API_BASE}/api/rooms`,
};
const REFRESH_INTERVAL = 5000;

/* =========================
 * 2) STATE
 * ========================= */
let cats = [];
let selectedCatId = null;        // ชื่อแมวที่เลือก (จำมาจากหน้า Cat/Detail)
let refreshTimer = null;

let rooms = [];                  // [{name, cameras:[{label,index}]}]
let currentRoomIndex = null;
let currentCameraIndex = 0;
let cameraTimestampTimer = null;

// navigation: จำหน้าเดิมก่อนเปิด Alerts
let lastPageId = null;

// Alerts states
let selectedAlertIds = new Set();
let lastAlertsRaw = [];          // รายการดิบจาก API (ของแมวที่เลือก)

// โฟกัสแถว alert เฉพาะเมื่อมาจากหน้า Notifications
let _focusAlertId = null;

function focusAlertIfNeeded() {
  if (!_focusAlertId) return;
  const el = document.querySelector(`.alert-item[data-id="${_focusAlertId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("pulse-highlight");
    setTimeout(() => el.classList.remove("pulse-highlight"), 2500);
  }
  _focusAlertId = null;
}

/* =========================
 * 3) STARTUP
 * ========================= */
document.addEventListener("DOMContentLoaded", () => {
  fetchCatDataFromAPI();
  refreshTimer = setInterval(updateCatData, REFRESH_INTERVAL);
  loadSystemConfig();

  loadRoomsAndRender();
});

/* =========================
 * Utils
 * ========================= */
function getVisiblePageId() {
  const ids = [
    "homePage","cameraPage","catPage","profilePage",
    "catDetailPage","systemConfigPage","notificationsPage",
    "alertsPage","statisticsPage"
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains("hidden")) return id;
  }
  return null;
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function handleFetchError(err) {
  console.error("❌ API Error:", err);
  if (!document.body.dataset.alerted) {
    alert("ไม่สามารถเชื่อมต่อ API ได้ กรุณาตรวจสอบว่า Flask ทำงานอยู่หรือไม่");
    document.body.dataset.alerted = "true";
  }
}

function fmtDateTime(s) {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleString();
}

function priorityClass(type) {
  switch (type) {
    case "no_cat":
    case "no_eating":    return "high-priority";
    case "low_excrete":
    case "high_excrete": return "medium-priority";
    case "low_sleep":
    case "high_sleep":   return "low-priority";
    default:             return "";
  }
}

/* =========================
 * 4) CATS: โหลด/เรนเดอร์
 * ========================= */
function fetchCatDataFromAPI() {
  fetch(ENDPOINTS.cats)
    .then(res => res.json())
    .then(data => {
      cats = Array.isArray(data) ? data : [];
      renderCatCards(cats);
    })
    .catch(handleFetchError);
}

function updateCatData() {
  fetch(ENDPOINTS.cats)
    .then(res => res.json())
    .then(data => {
      cats = Array.isArray(data) ? data : [];
      renderCatCards(cats);
      updateOpenCatDetail();
    })
    .catch(handleFetchError);
}

function renderCatCards(catList) {
  const container = document.querySelector(".cat-grid");
  if (!container) return;
  container.innerHTML = "";

  const seen = new Set();
  catList.forEach((cat) => {
    if (seen.has(cat.name)) return;
    seen.add(cat.name);

    const card = document.createElement("div");
    card.className = "cat-card";
    card.onclick = () => selectCat(cat.name);

    card.innerHTML = `
      <img src="${cat.image_url}" alt="${cat.name}" class="cat-image">
      <h3>${cat.name}</h3>
    `;
    container.appendChild(card);
  });
}

/* =========================
 * 5) CAT DETAIL
 * ========================= */
function selectCat(catName) {
  const cat = cats.find((c) => c.name === catName);
  if (!cat) return;

  selectedCatId = catName; // จำชื่อแมวไว้ใช้ที่ Alerts
  document.getElementById("catDetailName").textContent = cat.name;
  document.getElementById("catProfileName").textContent = `Name ${cat.name}`;
  document.getElementById("catDetailImage").src = cat.image_url;
  document.getElementById("catLocation").textContent = cat.current_room || "Unknown";
  document.getElementById("catPage").classList.add("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.remove("hidden");
}

function goBackToCatGallery() {
  selectedCatId = null;
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("catPage").classList.remove("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
}

function updateOpenCatDetail() {
  if (selectedCatId && !document.getElementById("catDetailPage").classList.contains("hidden")) {
    const cat = cats.find((c) => c.name === selectedCatId);
    if (cat) {
      document.getElementById("catLocation").textContent = cat.current_room || "Unknown";
    }
  }
}

/* =========================
 * 6) ROOMS & CAMERA
 * ========================= */
function loadRoomsAndRender() {
  fetch(ENDPOINTS.rooms)
    .then(res => res.json())
    .then(data => {
      rooms = Array.isArray(data) ? data : [];
      renderRoomCards(rooms);
    })
    .catch(err => console.error("❌ โหลดผังห้อง/กล้องล้มเหลว:", err));
}

function renderRoomCards(roomList) {
  const grid = document.querySelector(".room-grid");
  if (!grid) return;
  grid.innerHTML = "";
  roomList.forEach((room, idx) => {
    const card = document.createElement("div");
    card.className = "room-card";
    card.onclick = () => selectRoom(idx);
    card.innerHTML = `
      <div class="room-preview">
        <div class="live-preview">
          <div class="camera-placeholder">📹</div>
        </div>
      </div>
      <h3>${capitalize(room.name || "Room")}</h3>
      <button class="select-btn">เลือกห้อง</button>
    `;
    grid.appendChild(card);
  });
}

function selectRoom(index) {
  if (index < 0 || index >= rooms.length) return;
  currentRoomIndex = index;
  currentCameraIndex = 0;

  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("cameraPage").classList.remove("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");

  updateCameraUI();

  if (cameraTimestampTimer) clearInterval(cameraTimestampTimer);
  cameraTimestampTimer = setInterval(() => {
    document.getElementById("timestamp").textContent = new Date().toLocaleString();
  }, 1000);
}

function updateCameraUI() {
  if (currentRoomIndex === null) return;

  const room = rooms[currentRoomIndex] || {};
  const cams = room.cameras || [];
  const cam = cams[currentCameraIndex];

  document.getElementById("currentRoomName").textContent = capitalize(room.name || "Room");
  document.getElementById("cameraInfo").textContent = cams.length
    ? `กล้อง ${currentCameraIndex + 1} จาก ${cams.length}`
    : `ไม่มีกล้องในห้องนี้`;

  const feed = cam ? `${API_BASE}/video_feed/${room.name}/${cam.index}` : "";
  document.getElementById("cameraFeed").innerHTML = cam
    ? `<img src="${feed}" style="width:100%; height:100%; object-fit:cover;" alt="${cam.label}">`
    : `<div class="simulated-video"><div class="camera-placeholder large">📹</div><p>ไม่มีกล้อง</p></div>`;

  const prevBtn = document.querySelector(".camera-controls .nav-btn:first-child");
  const nextBtn = document.querySelector(".camera-controls .nav-btn:last-child");
  if (prevBtn) prevBtn.disabled = currentCameraIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentCameraIndex >= cams.length - 1;

  document.getElementById("timestamp").textContent = new Date().toLocaleString();
}

function previousCamera() {
  if (currentRoomIndex === null) return;
  if (currentCameraIndex > 0) {
    currentCameraIndex--;
    updateCameraUI();
  }
}

function nextCamera() {
  if (currentRoomIndex === null) return;
  const cams = rooms[currentRoomIndex]?.cameras || [];
  if (currentCameraIndex < cams.length - 1) {
    currentCameraIndex++;
    updateCameraUI();
  }
}

function goBack() {
  currentRoomIndex = null;
  if (cameraTimestampTimer) {
    clearInterval(cameraTimestampTimer);
    cameraTimestampTimer = null;
  }
  document.getElementById("cameraPage").classList.add("hidden");
  document.getElementById("homePage").classList.remove("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
}

/* =========================
 * 7) PAGE NAV
 * ========================= */
function showHomePage() {
  selectedCatId = null;
  currentRoomIndex = null;
  if (cameraTimestampTimer) {
    clearInterval(cameraTimestampTimer);
    cameraTimestampTimer = null;
  }
  document.getElementById("homePage").classList.remove("hidden");
  document.getElementById("cameraPage").classList.add("hidden");
  document.getElementById("catPage").classList.add("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.add("hidden");
}

function showCatPage() {
  selectedCatId = null;
  currentRoomIndex = null;
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("cameraPage").classList.add("hidden");
  document.getElementById("catPage").classList.remove("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.add("hidden");
}

function showNotificationsPage() {
  selectedCatId = null;
  currentRoomIndex = null;
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("cameraPage").classList.add("hidden");
  document.getElementById("catPage").classList.add("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.remove("hidden");
}

function showProfilePage() {
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("profilePage").classList.remove("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.add("hidden");
}

function showSystemConfigPage() {
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.remove("hidden");
  loadSystemConfig();
}

/* =========================
 * 8) HAMBURGER MENU
 * ========================= */
function toggleMenu() {
  const menu = document.getElementById("navMenu");
  const overlay = document.getElementById("menuOverlay");
  const hamburgerBtn = document.querySelector(".hamburger-btn");

  if (menu.classList.contains("hidden")) {
    menu.classList.remove("hidden");
    menu.classList.add("show");
    overlay.classList.add("show");
    hamburgerBtn.classList.add("active");
    hamburgerBtn.innerHTML = "X";
  } else {
    closeMenu();
  }
}

function closeMenu() {
  const menu = document.getElementById("navMenu");
  const overlay = document.getElementById("menuOverlay");
  const hamburgerBtn = document.querySelector(".hamburger-btn");

  menu.classList.remove("show");
  overlay.classList.remove("show");
  hamburgerBtn.classList.remove("active");
  hamburgerBtn.innerHTML = "☰";

  setTimeout(() => menu.classList.add("hidden"), 300);
}
/* =========================
 * 9) STATISTICS (enhanced)
 * ========================= */
let statsChartInstance = null;
let availableYears = [];  // ปีทั้งหมดใน DB (ASC)

function showCatStatisticsPage() {
  if (!selectedCatId) { alert("กรุณาเลือกแมวก่อน"); return; }

  document.getElementById("catDetailPage")?.classList.add("hidden");
  document.getElementById("statisticsPage")?.classList.remove("hidden");

  const titleEl = document.getElementById("statisticsTitle");
  if (titleEl) titleEl.textContent = `${selectedCatId}'s Statistics`;

  // เติมแมวใน dropdown ให้ตรง selectedCatId ปัจจุบัน
  const catSel = document.getElementById("catSelect");
  if (catSel) {
    catSel.innerHTML = "";
    cats.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name; opt.textContent = c.name;
      if (c.name === selectedCatId) opt.selected = true;
      catSel.appendChild(opt);
    });
    catSel.onchange = () => {
      selectedCatId = catSel.value;
      if (titleEl) titleEl.textContent = `${selectedCatId}'s Statistics`;
      updateStatistics();
    };
  }

  // เตรียมเดือน 1–12 (ไทย)
  const MONTHS = [
    ["01","ม.ค."],["02","ก.พ."],["03","มี.ค."],["04","เม.ย."],["05","พ.ค."],["06","มิ.ย."],
    ["07","ก.ค."],["08","ส.ค."],["09","ก.ย."],["10","ต.ค."],["11","พ.ย."],["12","ธ.ค."]
  ];
  const monthEl = document.getElementById("monthSelect");
  if (monthEl) {
    monthEl.innerHTML = "";
    MONTHS.forEach(([v,t]) => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = t; monthEl.appendChild(opt);
    });
    const now = new Date();
    monthEl.value = String(now.getMonth()+1).padStart(2,"0");
  }

  // โหลด “ปีทั้งหมดที่มีข้อมูล” → เติมทั้งปีเริ่ม และ ปีสิ้นสุด
  fetch(`${API_BASE}/api/statistics/years`)
    .then(r => r.json())
    .then(({years}) => {
      availableYears = (years || []).slice(); // ASC
      const startSel = document.getElementById("yearStartSelect");
      const endSel   = document.getElementById("yearSelect");
      [startSel, endSel].forEach(sel => {
        if (!sel) return;
        sel.innerHTML = "";
        availableYears.forEach(y => {
          const opt = document.createElement("option");
          opt.value = String(y); opt.textContent = String(y);
          sel.appendChild(opt);
        });
      });

      if (availableYears.length) {
        const minY = availableYears[0], maxY = availableYears[availableYears.length-1];
        if (startSel) startSel.value = String(minY);
        if (endSel)   endSel.value   = String(maxY);
      }

      const periodEl = document.getElementById("periodSelect");
      if (periodEl) {
        periodEl.value = "daily";
        periodEl.onchange = updateDateFilter;
      }
      updateDateFilter();
      updateStatistics();
    })
    .catch(handleFetchError);
}

function updateDateFilter() {
  const period   = document.getElementById("periodSelect")?.value || "daily";
  const yearSel  = document.getElementById("yearSelect");
  const monthSel = document.getElementById("monthSelect");
  const startSel = document.getElementById("yearStartSelect");

  if (period === "daily") {
    if (startSel) startSel.style.display = "none";
    if (yearSel)  yearSel.style.display  = "inline-block";
    if (monthSel) monthSel.style.display = "inline-block";
  } else if (period === "monthly") {
    if (startSel) startSel.style.display = "none";
    if (yearSel)  yearSel.style.display  = "inline-block";
    if (monthSel) monthSel.style.display = "none";
  } else { // yearly
    if (startSel) startSel.style.display = "inline-block"; // ปีเริ่มต้น
    if (yearSel)  yearSel.style.display  = "inline-block"; // ปีสิ้นสุด
    if (monthSel) monthSel.style.display = "none";
  }
}


function updateStatistics() { searchStatistics(); }

function searchStatistics() {
  if (!selectedCatId) return;
  const period = document.getElementById("periodSelect")?.value || "daily";
  const endYear = document.getElementById("yearSelect")?.value || "";
  const startYear = document.getElementById("yearStartSelect")?.value || "";
  const month  = document.getElementById("monthSelect")?.value || "";

  const qs = new URLSearchParams();
  qs.set("cat", selectedCatId);
  qs.set("period", period);

  if (period === "daily") {
    if (endYear) qs.set("year", endYear);
    if (month)   qs.set("month", month);
  } else if (period === "monthly") {
    if (endYear) qs.set("year", endYear);
  } else { // yearly
    if (startYear) qs.set("start_year", startYear);
    if (endYear)   qs.set("end_year", endYear);
  }

  fetch(`${API_BASE}/api/statistics?${qs.toString()}`)
    .then(r => r.json())
    .then(drawStatisticsAligned)
    .catch(handleFetchError);
}


/* ===== วาดกราฟ + จัดช่วงให้ตรงสเปค =====
   - daily  : 30 วันถอยหลัง (ปลายทาง = วันสุดท้ายของเดือนที่เลือก)
   - monthly: 12 เดือนของปีที่เลือก
   - yearly : ปีเริ่ม → ปีสิ้นสุด (inclusive)
*/
function drawStatisticsAligned(data) {
  if (!data) return;
  const period = document.getElementById("periodSelect")?.value || "daily";
  const year   = document.getElementById("yearSelect")?.value || "";
  const month  = document.getElementById("monthSelect")?.value || "";
  const startY = document.getElementById("yearStartSelect")?.value || "";

  // 1) target labels
  let targetLabels = [];
  if (period === "daily") {
    const end = lastDayOfYearMonth(year, month);
    targetLabels = lastNDates(end, 30).map(d => fmtYMD(d)); // 30 จุด
  } else if (period === "monthly") {
    targetLabels = [...Array(12)].map((_,i) => `${String(year).padStart(4,"0")}-${String(i+1).padStart(2,"0")}`);
  } else {
    const s = parseInt(startY || (availableYears[0] || new Date().getFullYear()), 10);
    const e = parseInt(year   || (availableYears[availableYears.length-1] || s), 10);
    targetLabels = rangeYears(Math.min(s,e), Math.max(s,e)).map(y => String(y));
  }

  // 2) align series (เติมศูนย์ถ้าไม่มีข้อมูล)
  const rawLabels = data.labels || [];
  const S = data.series || {};
  const names = ["eatCount","sleepMinutes","excreteCount"];
  const F = {};
  names.forEach(n => F[n] = alignSeries(targetLabels, rawLabels, S[n] || []));

// 3) วาด Chart.js
const ctx = document.getElementById("statsChart");
if (statsChartInstance) { statsChartInstance.destroy(); statsChartInstance = null; }

statsChartInstance = new Chart(ctx, {
  type: "line",
  data: {
    labels: targetLabels,
    datasets: [
      // กิน = จำนวนครั้ง (แกน y1, แสดงเป็นแท่ง)
      { label: "Eat (count)", data: F.eatCount, type: "bar", borderWidth: 1, yAxisID: "y1" },
      // นอน = นาที (แกน y, เส้น)
      { label: "Sleep (min)", data: F.sleepMinutes, borderWidth: 2, tension: 0.25, yAxisID: "y" },
      // ขับถ่าย = จำนวนครั้ง (แกน y1, แท่ง)
      { label: "Excrete (count)", data: F.excreteCount, type: "bar", borderWidth: 1, yAxisID: "y1" }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: "Minutes" }
      },
      y1: {
        beginAtZero: true,
        position: "right",
        title: { display: true, text: "Count" },
        grid: { drawOnChartArea: false }
      }
    },
    plugins: {
      legend: { position: "bottom" },
      tooltip: { mode: "index", intersect: false }
    },
    interaction: { mode: "index", intersect: false }
  }
});
  // 4) การ์ดสรุป (จากชุดที่ align แล้ว)
  setText("sleepTime", `${(sum(F.sleepMinutes)/60).toFixed(1)} ชั่วโมง`);
  setText("eatTime", `${sum(F.eatMinutes)} นาที`);
}

/* ===== Helpers ===== */
function alignSeries(targetLabels, rawLabels, rawSeries) {
  const m = new Map();
  rawLabels.forEach((lb, i) => m.set(String(lb), Number(rawSeries[i] || 0)));
  return targetLabels.map(lb => Number(m.get(String(lb)) || 0));
}
function sum(arr){ return (arr||[]).reduce((a,b)=>a+(Number(b)||0),0); }
function lastDayOfYearMonth(y, m) {
  const Y = parseInt(y || new Date().getFullYear(), 10);
  const M = parseInt(m || (new Date().getMonth()+1), 10);
  return new Date(Y, M, 0); // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
}
function lastNDates(endDate, N) {
  const out = []; const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  for (let i = N-1; i >= 0; i--) { const d = new Date(end); d.setDate(end.getDate() - i); out.push(d); }
  return out;
}
function fmtYMD(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dd}`; }
function rangeYears(s,e){ const out=[]; for(let y=s; y<=e; y++) out.push(y); return out; }

function goBackFromStatistics() {
  const stats = document.getElementById("statisticsPage");
  const detail = document.getElementById("catDetailPage");
  const sys = document.getElementById("systemConfigPage");

  if (stats) stats.classList.add("hidden");
  if (detail) detail.classList.remove("hidden");
  if (sys) sys.classList.add("hidden");
}


/* =========================
 * 10) SYSTEM CONFIG
 * ========================= */
function loadSystemConfig() {
  fetch(ENDPOINTS.systemConfig)
    .then(res => res.json())
    .then(cfg => {
      const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el && v !== undefined && v !== null) el.value = v;
      };
      setVal("alertNoCat", cfg.alertNoCat);
      setVal("alertNoEating", cfg.alertNoEating);
      setVal("minExcretion", cfg.minExcretion);
      setVal("maxExcretion", cfg.maxExcretion);
      setVal("minSleep", cfg.minSleep);
      setVal("maxSleep", cfg.maxSleep);
      setVal("maxCats", cfg.maxCats);
    })
    .catch(()=>{});
}

function saveSystemConfig() {
  const payload = {
    alertNoCat: +document.getElementById("alertNoCat")?.value || null,
    alertNoEating: +document.getElementById("alertNoEating")?.value || null,
    minExcretion: +document.getElementById("minExcretion")?.value || null,
    maxExcretion: +document.getElementById("maxExcretion")?.value || null,
    minSleep: +document.getElementById("minSleep")?.value || null,
    maxSleep: +document.getElementById("maxSleep")?.value || null,
    maxCats: +document.getElementById("maxCats")?.value || null,
  };
  fetch(ENDPOINTS.systemConfig, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => alert("บันทึกการตั้งค่าแล้ว"))
  .catch(()=> alert("บันทึกไม่สำเร็จ"));
}

function resetSystemConfig() {
  fetch(`${ENDPOINTS.systemConfig}/reset`, { method: "POST" })
    .then(r => r.json())
    .then(() => {
      alert("รีเซ็ตการตั้งค่าแล้ว");
      loadSystemConfig();
    })
    .catch(()=> alert("รีเซ็ตไม่สำเร็จ"));
}

/* =========================
 * 11) ALERTS PAGE (per-cat only)
 * ========================= */

// แถบเครื่องมือด้านบน Alerts (อ่านทั้งหมด / ลบที่เลือก / แสดงเฉพาะที่ยังไม่อ่าน)
function ensureAlertsToolbar() {
  const container = document.querySelector("#alertsPage .alerts-container");
  if (!container) return;
  if (document.getElementById("alertsToolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.id = "alertsToolbar";
  toolbar.className = "alerts-toolbar";
  toolbar.style = "display:flex; gap:8px; margin:10px 0;";
  toolbar.innerHTML = `
    <button class="apply-filter-btn" onclick="markAllRead()">อ่านทั้งหมด</button>
    <button class="clear-filter-btn" onclick="deleteSelected()" id="deleteSelectedBtn" disabled>ลบที่เลือก</button>
    <label style="margin-left:auto; display:flex; align-items:center; gap:6px;">
      <input type="checkbox" id="showUnreadOnly" onchange="applyFilters()" />
      แสดงเฉพาะที่ยังไม่อ่าน
    </label>
  `;
  container.prepend(toolbar);
}

function updateDeleteButtonState() {
  const btn = document.getElementById("deleteSelectedBtn");
  if (btn) btn.disabled = selectedAlertIds.size === 0;
}

function removeAlertFromUI(id) {
  const el = document.querySelector(`.alert-item[data-id="${id}"]`);
  if (el && el.parentElement) {
    el.parentElement.removeChild(el);
  }
}


// โหลดข้อมูล: ต้องมี selectedCatId เสมอ, ดึงเฉพาะแมวตัวนั้น, จากนั้น applyFilters
function loadAlerts() {
  ensureAlertsToolbar();
  const list = document.getElementById("alertsList");
  if (!list) return;

  // บังคับให้เลือกแมวก่อนเข้าหน้า Alerts
  if (!selectedCatId) {
    list.innerHTML = `
      <div class="alert-item">
        กรุณาเลือกแมวจากหน้า Cat/รายละเอียดแมวก่อน เพื่อดู Alerts ของแมวตัวนั้น
      </div>
    `;
    return;
  }

  selectedAlertIds.clear();
  updateDeleteButtonState();

  const qs = new URLSearchParams();
  qs.set("cat", selectedCatId);
  qs.set("include_read", "1"); // ดึงทั้งหมดก่อน ค่อยกรอง unread ใน client

  fetch(`${ENDPOINTS.alerts}?${qs.toString()}`)
    .then(res => res.json())
    .then(rows => {
      lastAlertsRaw = Array.isArray(rows) ? rows : [];
      applyFilters(); // กรองเฉพาะยังไม่อ่าน (ถ้าติ๊ก), และ (ตอกย้ำ) เฉพาะแมวที่เลือก
    })
    .catch(err => {
      console.error("Error loading alerts:", err);
      list.innerHTML = `<div class="alert-item">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>`;
    });
}

// กรองในหน้า (ไม่อนุญาตเปลี่ยนแมว): เหลือเฉพาะ unread ถ้าติ๊ก
function applyFilters() {
  const list = document.getElementById("alertsList");
  if (!list) return;

  // กรองเฉพาะแมวที่เลือก + เฉพาะยังไม่อ่าน (ถ้าติ๊ก)
  const unreadOnly = document.getElementById("showUnreadOnly")?.checked || false;
  let rows = lastAlertsRaw.filter(a => (a.cat || "") === selectedCatId);
  if (unreadOnly) rows = rows.filter(a => !a.is_read);

  renderAlerts(rows);
}

// ล้างฟิลเตอร์ด้านบน (ไม่เกี่ยวกับการเลือกแมว จึงเหลือแค่ยกเลิกติ๊ก unread)
function clearFilters() {
  const unreadOnly = document.getElementById("showUnreadOnly");
  if (unreadOnly) unreadOnly.checked = false;
  applyFilters();
}

// วาด UI (กลุ่มเดียวของแมวที่เลือก) — ไม่มี “ล้างตัวกรอง”
function renderAlerts(rows) {
  const list = document.getElementById("alertsList");
  if (!list) return;
  list.innerHTML = "";
  selectedAlertIds.clear();
  updateDeleteButtonState();

  if (!rows || rows.length === 0) {
    list.innerHTML = `<div class="alert-item">ไม่มีการแจ้งเตือน</div>`;
    return;
  }

  const groupWrap = document.createElement("div");
  groupWrap.className = "alert-cat-group";

  const header = document.createElement("div");
  header.className = "alert-cat-title";
  header.textContent = selectedCatId;
  groupWrap.appendChild(header);

  const itemsWrap = document.createElement("div");
  itemsWrap.className = "alert-items";

  rows.forEach(a => {
    const item = document.createElement("div");
    item.className = `alert-item ${priorityClass(a.type)} ${a.is_read ? "read" : ""}`;
    item.dataset.id = a.id;

    item.innerHTML = `
      <div class="alert-line" style="justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:8px; flex:1;">
          <input type="checkbox" class="alert-select" />
          <span class="alert-type-tag">${a.type}</span>
          <span class="alert-text">${a.message}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; white-space:nowrap;">
          <span class="alert-time">${fmtDateTime(a.created_at)}</span>
          <button class="apply-filter-btn" onclick="markOneRead(${a.id})" ${a.is_read ? "disabled":""}>อ่าน</button>
          <button class="clear-filter-btn" onclick="deleteOne(${a.id})">ลบ</button>
        </div>
      </div>
    `;

    // เลือกหลายรายการ
    item.querySelector(".alert-select").addEventListener("change", (ev) => {
      if (ev.target.checked) selectedAlertIds.add(a.id);
      else selectedAlertIds.delete(a.id);
      updateDeleteButtonState();
    });

    itemsWrap.appendChild(item);
  });

  groupWrap.appendChild(itemsWrap);
  list.appendChild(groupWrap);


  focusAlertIfNeeded();
}

// ทำเครื่องหมาย “อ่าน” (รายการเดียว)
function markOneRead(id) {
  fetch(ENDPOINTS.alertsMarkRead, {
    method: "PATCH",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ids: [id]})
  })
  .then(res => res.json())
  .then(() => loadAlerts())
  .catch(()=>{});
}

// อ่านทั้งหมด (เฉพาะแมวที่เลือก)
function markAllRead() {
  if (!selectedCatId) return;
  const url = `${ENDPOINTS.alertsMarkAllRead}?cat=${encodeURIComponent(selectedCatId)}`;
  fetch(url, { method: "PATCH" })
    .then(res => res.json())
    .then(() => loadAlerts())
    .catch(()=>{});
}

// ลบหนึ่งรายการ
function deleteOne(id) {
  const btn = event?.currentTarget;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังลบ...";
  }

  fetch(ENDPOINTS.alertsDelete, {
    method: "DELETE",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ids: [id]})
  })
  .then(async (res) => {
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) {
      throw new Error(data?.message || "ลบไม่สำเร็จ");
    }
    if (typeof data.deleted === "number" && data.deleted > 0) {
      // ลบสำเร็จ: เอาออกจาก DOM ทันที
      removeAlertFromUI(id);
      // อัปเดตรายการในหน่วยความจำด้วย
      lastAlertsRaw = lastAlertsRaw.filter(a => a.id !== id);
      updateDeleteButtonState();
      // ถ้าต้องการรีเฟรชใหม่ทั้ง list ก็เรียก loadAlerts(); ได้
      // loadAlerts();
    } else {
      throw new Error("ไม่พบรายการให้ลบ (deleted=0)");
    }
  })
  .catch(err => {
    console.error("❌ deleteOne error:", err);
    alert("ลบไม่สำเร็จ: " + err.message);
  })
  .finally(() => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "ลบ";
    }
  });
}


// ลบที่เลือก
function deleteSelected() {
  if (selectedAlertIds.size === 0) return;

  const ids = Array.from(selectedAlertIds);
  const btn = document.getElementById("deleteSelectedBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังลบ...";
  }

  fetch(ENDPOINTS.alertsDelete, {
    method: "DELETE",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ids})
  })
  .then(async (res) => {
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) {
      throw new Error(data?.message || "ลบไม่สำเร็จ");
    }
    if (typeof data.deleted === "number" && data.deleted > 0) {
      // ลบสำเร็จ: เอาไอเท็มออกจาก DOM ทีละตัว
      ids.forEach(id => removeAlertFromUI(id));
      // อัปเดตสถานะในหน่วยความจำ
      lastAlertsRaw = lastAlertsRaw.filter(a => !selectedAlertIds.has(a.id));
      selectedAlertIds.clear();
      updateDeleteButtonState();
      // อยากรีเฟรชจากเซิร์ฟเวอร์ใหม่ทั้งหมดก็ loadAlerts(); ได้
      // loadAlerts();
    } else {
      throw new Error("ไม่พบรายการให้ลบ (deleted=0)");
    }
  })
  .catch(err => {
    console.error("❌ deleteSelected error:", err);
    alert("ลบไม่สำเร็จ: " + err.message);
  })
  .finally(() => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "ลบที่เลือก";
    }
  });
}

function showAlertsPage(catName = null, focusAlertId = null) {
  // จำหน้าเดิมก่อนสลับ
  lastPageId = getVisiblePageId();

  // ซ่อนหน้าอื่น ๆ
  ["homePage","cameraPage","catPage","profilePage","catDetailPage","systemConfigPage","notificationsPage","statisticsPage"]
    .forEach(id => document.getElementById(id)?.classList.add("hidden"));

  // โชว์ Alerts
  document.getElementById("alertsPage")?.classList.remove("hidden");

  // เซ็ตแมวและ id ที่จะโฟกัส (ถ้าส่งมา)
  if (catName) selectedCatId = catName;
  _focusAlertId = focusAlertId;

  // โหลดเฉพาะแมวที่เลือก
  loadAlerts();
}

// ย้อนกลับจาก Alerts
function goBackFromAlerts() {
  // ซ่อน Alerts
  document.getElementById("alertsPage")?.classList.add("hidden");

  // กลับหน้าเดิม ถ้าไม่มีให้กลับ Home
  if (lastPageId && document.getElementById(lastPageId)) {
    document.getElementById(lastPageId).classList.remove("hidden");
  } else {
    showHomePage();
  }
  lastPageId = null;
}

/* =========================
 * 12) Notifications & Profile
 * ========================= */
function showMyInformation() {
  alert("ชื่อ: Kamonrat\nบทบาท: ผู้ดูแลแมว");
}

function showNotificationSettings() {
  alert("การตั้งค่าการแจ้งเตือนยังไม่พร้อมใช้งาน");
}

function signOut() {
  alert("ออกจากระบบเรียบร้อยแล้ว");
  showHomePage();
}

/* =========================
 * Notifications — แสดงแจ้งเตือน "ยังไม่อ่าน" ของทุกแมว
 * ========================= */

function loadNotifications() {
  const container = document.querySelector("#notificationsPage .notifications-list");
  if (!container) return;
  container.innerHTML = `<div class="notification-item">กำลังโหลด...</div>`;

  // ดึงเฉพาะยังไม่อ่านทั้งหมด (ทุกแมว)
  const qs = new URLSearchParams();
  qs.set("include_read", "0");

  fetch(`${ENDPOINTS.alerts}?${qs.toString()}`)
    .then(r => r.json())
    .then(rows => renderNotifications(Array.isArray(rows) ? rows : []))
    .catch(() => {
      container.innerHTML = `<div class="notification-item">โหลดข้อมูลไม่ได้</div>`;
    });
}

function renderNotifications(rows) {
  const container = document.querySelector("#notificationsPage .notifications-list");
  if (!container) return;
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = `<div class="notification-item">ยังไม่พบการแจ้งเตือนใหม่</div>`;
    return;
  }

  rows.forEach(a => {
    const item = document.createElement("div");
    item.className = `notification-item unread`;
    item.style.cursor = "pointer";
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
        <div style="display:flex; flex-direction:column;">
          <strong>${a.cat || "-"}</strong>
          <span style="font-size:0.9em; color:#555;">${a.message}</span>
          <span style="font-size:0.85em; color:#777;">${fmtDateTime(a.created_at)}</span>
        </div>
        <button class="apply-filter-btn">ดูใน Alerts</button>
      </div>
    `;

   const go = () => {
  
  fetch(ENDPOINTS.alertsMarkRead, {
    method: "PATCH",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ ids: [a.id] })
  }).finally(() => showAlertsPage(a.cat, a.id));
};

    container.appendChild(item);
  });
}

// override หน้า Notifications เดิมให้เรียกโหลดจริง
function showNotificationsPage() {
  selectedCatId = null;
  currentRoomIndex = null;

  ["homePage","cameraPage","catPage","profilePage","catDetailPage","systemConfigPage","alertsPage","statisticsPage"]
    .forEach(id => document.getElementById(id)?.classList.add("hidden"));

  document.getElementById("notificationsPage").classList.remove("hidden");
  loadNotifications();
}

