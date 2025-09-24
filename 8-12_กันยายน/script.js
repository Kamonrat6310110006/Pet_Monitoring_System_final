// 1) CONFIG -------------------------------------------------
const API_BASE = "http://localhost:5000";
const ENDPOINTS = {
  cats: `${API_BASE}/api/cats`,
  alerts: `${API_BASE}/api/alerts`,
  systemConfig: `${API_BASE}/api/system_config`,
  rooms: `${API_BASE}/api/rooms`,
};

const REFRESH_INTERVAL = 5000;

// 2) STATE --------------------------------------------------
let cats = [];
let selectedCatId = null;
let refreshTimer = null;

let rooms = [];                // [{name, cameras:[{label,index}]}]
let currentRoomIndex = null;
let currentCameraIndex = 0;
let cameraTimestampTimer = null;

// สำหรับการย้อนกลับจาก Alerts
let lastPageId = null; // เก็บ id ของหน้าเดิมก่อนเปิด Alerts

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

// 3) STARTUP ------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  fetchCatDataFromAPI();
  refreshTimer = setInterval(updateCatData, REFRESH_INTERVAL);
  loadSystemConfig();
  startAlertsWatcher();

  loadRoomsAndRender();

  // === Bind ปุ่ม/ลิงก์ไปหน้า Alerts ให้กดเข้าได้แน่นอน ===
  const maybeBind = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (e) => {
      e.preventDefault?.();
      closeMenu?.();
      handler();
    });
  };
  // ปุ่ม/เมนูทั่วไป
  maybeBind("alertsNav", () => openAlerts(null));
  maybeBind("alertsMenuItem", () => openAlerts(null));
  maybeBind("alertsButton", () => openAlerts(null));
  // ปุ่มในหน้าแมวให้กรองเฉพาะแมวนั้น
  maybeBind("goAlertsFromCat", () => openAlerts(selectedCatId));

  // รองรับปุ่มที่ใช้ class
  document.querySelectorAll(".view-alerts-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault?.();
      closeMenu?.();
      openAlerts(null);
    });
  });
  document.querySelectorAll(".view-alerts-for-this-cat").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault?.();
      closeMenu?.();
      const name = selectedCatId || btn.dataset.catName || null;
      openAlerts(name);
    });
  });

  // —— ปุ่มย้อนกลับจาก Alerts ——
  const bindBack = (id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (e) => {
      e.preventDefault?.();
      goBackFromAlerts();
    });
  };
  bindBack("alertsBackBtn");
  bindBack("backFromAlertsBtn");
  document.querySelectorAll(".alerts-back-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault?.();
      goBackFromAlerts();
    });
  });
});

// เปิดหน้า Alerts (option: กรองตามแมว)
function openAlerts(catName = null) {
  if (catName) selectedCatId = catName;
  showAlertsPage();
}

// 4) API HANDLERS ------------------------------------------
function fetchCatDataFromAPI() {
  fetch(ENDPOINTS.cats)
    .then(res => res.json())
    .then(data => {
      cats = data;
      renderCatCards(cats);
    })
    .catch(handleFetchError);
}

function updateCatData() {
  fetch(ENDPOINTS.cats)
    .then(res => res.json())
    .then(data => {
      cats = data;
      renderCatCards(cats);
      updateOpenCatDetail();
    })
    .catch(handleFetchError);
}

function handleFetchError(err) {
  console.error("❌ ไม่สามารถโหลดข้อมูลแมว:", err);
  if (!document.body.dataset.alerted) {
    alert("ไม่สามารถเชื่อมต่อ API ได้ กรุณาตรวจสอบว่า Flask ทำงานอยู่หรือไม่");
    document.body.dataset.alerted = "true";
  }
}

// 4.1) ROOMS -----------------------------------------------
function loadRoomsAndRender() {
  fetch(ENDPOINTS.rooms)
    .then(res => res.json())
    .then(data => {
      rooms = Array.isArray(data) ? data : [];
      renderRoomCards(rooms);
    })
    .catch(err => {
      console.error("❌ โหลดผังห้อง/กล้องล้มเหลว:", err);
    });
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

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// 5) RENDER (CAT GALLERY) ----------------------------------
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

// ฟังก์ชันแสดงหน้า Cat Page
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

// 6) CAT DETAIL --------------------------------------------
function selectCat(catName) {
  const cat = cats.find((c) => c.name === catName);
  if (!cat) return;

  selectedCatId = catName;
  document.getElementById("catDetailName").textContent = cat.name;
  document.getElementById("catProfileName").textContent = `Name ${cat.name}`;
  document.getElementById("catDetailImage").src = cat.image_url;
  document.getElementById("catLocation").textContent = cat.current_room || "ไม่ทราบ";
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
      document.getElementById("catLocation").textContent = cat.current_room || "ไม่ทราบ";
    }
  }
}

// 7) ROOM & CAMERA NAVIGATION ------------------------------
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

// 8) PAGE NAVIGATION --------------------------------------
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

// 9) HAMBURGER MENU ---------------------------------------
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

// 10) STATISTICS PAGE --------------------------------------
function updateStatistics() {
  searchStatistics();
}

function updateDateFilter() {
  const period = document.getElementById("periodSelect").value;
  const monthSelect = document.getElementById("monthSelect");
  if (period === "yearly") {
    monthSelect.style.display = "none";
  } else {
    monthSelect.style.display = "inline-block";
  }
}

function searchStatistics() {
  console.log("Statistics search functionality not implemented yet");
}

// 11) ALERTS PAGE ------------------------------------------
function loadAlerts() {
  fetch(ENDPOINTS.alerts)
    .then(res => res.json())
    .then(alerts => {
      const list = document.getElementById("alertsList");
      list.innerHTML = "";

      // จัดกลุ่มตามชื่อแมว
      const byCat = alerts.reduce((acc, a) => {
        const cat = a.cat || "ไม่ทราบชื่อ";
        (acc[cat] ||= []).push(a);
        return acc;
      }, {});

      // ถ้ามาจากหน้า Cat Detail และมี selectedCatId ให้แสดงเฉพาะของแมวตัวนั้น
      const catsToRender = selectedCatId ? [selectedCatId] : Object.keys(byCat).sort();

      // วาดหัวกรอง (เฉพาะตอนมี selectedCatId)
      if (selectedCatId) {
        const filterBar = document.createElement("div");
        filterBar.style.marginBottom = "10px";
        filterBar.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span>กรองตามแมว: <strong>${selectedCatId}</strong></span>
            <button class="clear-filter-btn" onclick="(function(){ selectedCatId=null; loadAlerts(); })()">ล้างตัวกรอง</button>
          </div>
        `;
        list.appendChild(filterBar);
      }

      if (catsToRender.length === 0) {
        list.innerHTML += `<div class="alert-item">ไม่มีการแจ้งเตือน</div>`;
        return;
      }

      const priorityClass = (type) => {
        switch (type) {
          case "no_cat":       return "high-priority";
          case "no_eating":    return "high-priority";
          case "low_excrete":  return "medium-priority";
          case "high_excrete": return "medium-priority";
          case "low_sleep":    return "low-priority";
          case "high_sleep":   return "low-priority";
          default:             return "";
        }
      };

      // เรนเดอร์เป็นกลุ่มต่อแมว
      catsToRender.forEach(cat => {
        const groupWrap = document.createElement("div");
        groupWrap.className = "alert-cat-group";

        const header = document.createElement("div");
        header.className = "alert-cat-title";
        header.textContent = cat;
        groupWrap.appendChild(header);

        const itemsWrap = document.createElement("div");
        itemsWrap.className = "alert-items";

        (byCat[cat] || []).forEach(a => {
          const item = document.createElement("div");
          item.className = `alert-item ${priorityClass(a.type)}`;
          item.innerHTML = `
            <div class="alert-line">
              <span class="alert-type-tag">${a.type}</span>
              <span class="alert-text">${a.message}</span>
            </div>
          `;
          itemsWrap.appendChild(item);
        });

        groupWrap.appendChild(itemsWrap);
        list.appendChild(groupWrap);
      });
    })
    .catch(err => console.error("Error loading alerts:", err));
}

// ✅ แสดงหน้า Alerts ให้แน่ใจว่ากดปุ่มแล้วเข้าได้ (และจำหน้าเดิม)
function showAlertsPage() {
  // จำหน้าเดิมก่อนสลับ
  lastPageId = getVisiblePageId();

  // ซ่อนหน้าอื่น ๆ
  ["homePage","cameraPage","catPage","profilePage","catDetailPage","systemConfigPage","notificationsPage","statisticsPage"]
    .forEach(id => document.getElementById(id)?.classList.add("hidden"));

  // โชว์หน้า Alerts
  document.getElementById("alertsPage")?.classList.remove("hidden");

  // โหลดแจ้งเตือน (group by cat + รองรับ selectedCatId)
  if (typeof loadAlerts === "function") loadAlerts();
}

// ⬅️ ปุ่มย้อนกลับจาก Alerts
function goBackFromAlerts() {
  // ซ่อน Alerts ก่อน
  document.getElementById("alertsPage")?.classList.add("hidden");

  // ถ้ามีหน้าเดิม จำไว้ก็กลับไปหน้านั้น ไม่งั้นกลับ Home
  if (lastPageId && document.getElementById(lastPageId)) {
    document.getElementById(lastPageId).classList.remove("hidden");
  } else {
    showHomePage();
  }

  // รีเซ็ตตัวแปรหน้าเดิม (กันสับสนรอบถัดไป)
  lastPageId = null;
}

// 12) PROFILE ----------------------------------------------
function showProfilePage() {
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("profilePage").classList.remove("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.add("hidden");
}

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

// 13) CAT STATISTICS NAV -----------------------------------
function showCatStatisticsPage() {
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("statisticsPage").classList.remove("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
}

function goBackFromStatistics() {
  document.getElementById("statisticsPage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.remove("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
}

// 14) SYSTEM CONFIG ----------------------------------------
function showSystemConfigPage() {
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.remove("hidden");
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.add("hidden");
}

function loadSystemConfig() {
  fetch(ENDPOINTS.systemConfig)
    .then(res => res.json())
    .then(data => {
      const get = id => document.getElementById(id);
      const map = [
        ["alertNoCat", "alertNoCat"],
        ["alertNoEating", "alertNoEating"],
        ["minExcretion", "minExcretion"],
        ["maxExcretion", "maxExcretion"],
        ["minSleep", "minSleep"],
        ["maxSleep", "maxSleep"],
        ["maxCats", "maxCats"],
      ];
      map.forEach(([key, id]) => {
        const el = get(id);
        if (el && data[key] !== undefined && data[key] !== null) el.value = data[key];
      });
    })
    .catch(err => {
      console.error("Error loading system config:", err);
      alert("เกิดข้อผิดพลาดในการโหลดการตั้งค่าจากระบบ");
    });
}

function saveSystemConfig() {
  const num = id => parseFloat(document.getElementById(id)?.value);
  const config = {
    alertNoCat:    num('alertNoCat'),
    alertNoEating: num('alertNoEating'),
    minExcretion:  num('minExcretion'),
    maxExcretion:  num('maxExcretion'),
    minSleep:      num('minSleep'),
    maxSleep:      num('maxSleep'),
    maxCats:       num('maxCats'),
  };

  if (!(config.alertNoCat >= 1 && config.alertNoCat <= 48))      return alert('Alert No Cat ต้องอยู่ระหว่าง 1-48 ชั่วโมง');
  if (!(config.alertNoEating >= 1 && config.alertNoEating <= 24)) return alert('Alert No Eating ต้องอยู่ระหว่าง 1-24 ครั้ง/วัน');
  if (!(config.minExcretion < config.maxExcretion))               return alert('Minimum Excretion ต้องน้อยกว่า Maximum Excretion');
  if (!(config.minSleep < config.maxSleep))                       return alert('Minimum Sleep ต้องน้อยกว่า Maximum Sleep');
  if (!(config.maxCats >= 1))                                     return alert('Max Cats ต้องมากกว่าหรือเท่ากับ 1');

  fetch(ENDPOINTS.systemConfig, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(config),
  })
  .then(res => res.json())
  .then(() => alert('บันทึกการตั้งค่าเรียบร้อย'))
  .catch(() => alert('บันทึกล้มเหลว'));
}

function resetSystemConfig() {
  fetch(`${ENDPOINTS.systemConfig}/reset`, { method: 'POST' })
    .then(res => res.json())
    .then(() => {
      loadSystemConfig();
      alert('รีเซ็ตเป็นค่าเริ่มต้นแล้ว');
    })
    .catch(() => alert('รีเซ็ตไม่สำเร็จ'));
}

// 15) NOTIFICATION BADGE -----------------------------------
function updateNotificationBadge() {
  fetch(ENDPOINTS.alerts)
    .then(res => res.json())
    .then(alerts => {
      document.getElementById("notificationBadge").textContent = alerts.length;
    })
    .catch(err => console.error("Error updating badge:", err));
}
setInterval(updateNotificationBadge, 60000);
updateNotificationBadge();

// 16) alerts ------------------------------------------------
const ALERTS_POLL_MS = 60_000;

// ===== B) UTIL =====
const TODAY = () => new Date().toISOString().slice(0,10);
const SEEN_KEY = () => `alerts_seen_${TODAY()}`;
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY()) || "[]")); }
  catch { return new Set(); }
}
function saveSeen(seen) {
  localStorage.setItem(SEEN_KEY(), JSON.stringify(Array.from(seen)));
}
function makeKey(a) {
  return `${TODAY()}|${a.type}|${a.cat}|${a.message}`;
}

// ===== C) Browser Notification =====
function requestNotificationPermissionOnce() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(()=>{});
  }
}
function notifyBrowser(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try { new Notification(title, { body }); } catch {}
  }
}

// ===== D) Toast ในหน้า =====
function ensureToastContainer() {
  let c = document.getElementById("toastContainer");
  if (!c) {
    c = document.createElement("div");
    c.id = "toastContainer";
    Object.assign(c.style, {
      position: "fixed", right: "20px", bottom: "20px",
      display: "flex", flexDirection: "column", gap: "10px", zIndex: 9999
    });
    document.body.appendChild(c);
  }
  return c;
}
function showToast(text) {
  const c = ensureToastContainer();
  const box = document.createElement("div");
  Object.assign(box.style, {
    background: "#111", color: "#fff", padding: "12px 14px",
    borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
    maxWidth: "360px", fontSize: "14px", lineHeight: 1.4
  });
  box.textContent = text;
  c.appendChild(box);
  setTimeout(()=> box.remove(), 6000);
}

// ===== E) Watcher หลัก =====
let alertsTimer = null;
function startAlertsWatcher() {
  requestNotificationPermissionOnce();
  let seen = loadSeen();

  const tick = () => {
    fetch(ENDPOINTS.alerts)
      .then(r => r.json())
      .then(list => {
        let changed = false;
        list.forEach(a => {
          const key = makeKey(a);
          if (!seen.has(key)) {
            notifyBrowser(`Cat Alert: ${a.cat}`, a.message);
            showToast(`🚨 ${a.cat}: ${a.message}`);
            seen.add(key);
            changed = true;
          }
        });
        if (changed) saveSeen(seen);

        const open = !document.getElementById("alertsPage")?.classList.contains("hidden");
        if (open && typeof loadAlerts === "function") loadAlerts();
      })
      .catch(()=>{});
  };

  tick();
  if (alertsTimer) clearInterval(alertsTimer);
  alertsTimer = setInterval(tick, ALERTS_POLL_MS);
}
