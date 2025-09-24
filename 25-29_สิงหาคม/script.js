// 1) CONFIG -------------------------------------------------

const API_URL = "http://localhost:5000/api/cats"; // ปรับตาม backend 
const REFRESH_INTERVAL = 5000;                     // ดึงข้อมูลแมวใหม่ทุก 5 วิ

// รายชื่อห้องและจำนวนกล้องต่อห้อง
const ROOMS = [
  { name: "Hall", cameras: 1, cameraUrl: "http://localhost:5000/video_feed" }, // URL กล้อง IP
  { name: "Kitchen",    cameras: 1, cameraUrl: "http://ip-camera-url-2" },
  { name: "Garage",     cameras: 1, cameraUrl: "http://ip-camera-url-3" },
  { name: "Garden",  cameras: 1, cameraUrl: "http://ip-camera-url-4" }
];

// Default system configuration values
// const DEFAULT_SYSTEM_CONFIG = {
//   alertNoCat: 12,
//   alertNoEating: 2,
//   minExcretion: 3,
//   maxExcretion: 5,
//   minSleep: 8,
//   maxSleep: 16,
//   maxCats: 10
// };

// 2) STATE --------------------------------------------------
let cats = [];                 // แมวทั้งหมด
let selectedCatId = null;      // แมวในหน้า detail
let refreshTimer = null;       // setInterval ดึงแมว

let currentRoomIndex = null;   // index ห้องปัจจุบันใน ROOMS
let currentCameraIndex = 0;    // index กล้อง (0‑based)
let cameraTimestampTimer = null; // setInterval สำหรับ timestamp

// 3) STARTUP ------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  fetchCatDataFromAPI();
  refreshTimer = setInterval(updateCatData, REFRESH_INTERVAL);
  loadSystemConfig(); // Load system configuration from localStorage
});

// 4) API HANDLERS ------------------------------------------

function fetchCatDataFromAPI() {
  fetch(API_URL)
    .then((res) => res.json())
    .then((data) => {
      cats = data;
      renderCatCards(cats);
    })
    .catch(handleFetchError);
}

function updateCatData() {
  fetch(API_URL)
    .then((res) => res.json())
    .then((data) => {
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

// 5) RENDER (CAT GALLERY) ----------------------------------

function renderCatCards(catList) {
  const container = document.querySelector(".cat-grid");
  if (!container) return;
  container.innerHTML = "";

  const seen = new Set();
  catList.forEach((cat) => {
    if (seen.has(cat.name)) return; // ข้ามชื่อซ้ำ
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
  // Update cat detail page if currently open
  if (selectedCatId && !document.getElementById("catDetailPage").classList.contains("hidden")) {
    const cat = cats.find((c) => c.name === selectedCatId);
    if (cat) {
      document.getElementById("catLocation").textContent = cat.current_room || "ไม่ทราบ";
    }
  }
}

// 7) ROOM & CAMERA NAVIGATION ------------------------------

function selectRoom(index) {
  if (index < 0 || index >= ROOMS.length) return;
  currentRoomIndex = index;
  currentCameraIndex = 0; // เริ่มต้นที่กล้องแรกของห้อง

  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("cameraPage").classList.remove("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");

  updateCameraUI(); // อัปเดตข้อมูลกล้องและชื่อห้อง

  if (cameraTimestampTimer) clearInterval(cameraTimestampTimer);
  cameraTimestampTimer = setInterval(() => {
    document.getElementById("timestamp").textContent = new Date().toLocaleString();
  }, 1000);
}

function updateCameraUI() {
  const room = ROOMS[currentRoomIndex];
  const totalRooms = ROOMS.length;  // จำนวนห้องทั้งหมด
  const totalCamerasInRoom = room.cameras; // จำนวนกล้องในห้อง
  const isFirstCameraOverall = currentRoomIndex === 0 && currentCameraIndex === 0;
  const isLastCameraOverall = currentRoomIndex === totalRooms - 1 && currentCameraIndex === totalCamerasInRoom - 1;

  // แสดงชื่อห้อง
  document.getElementById("currentRoomName").textContent = `${room.name}`; 

  // ข้อมูลกล้อง ("กล้อง 1 จาก 4")
  document.getElementById("cameraInfo").textContent = `กล้อง ${currentRoomIndex + 1} จาก ${totalRooms}`;

  // ✅ เปลี่ยน iframe เป็น img (ใช้ MJPEG)
  document.getElementById("cameraFeed").innerHTML = `
    <img src="${room.cameraUrl}" style="width:100%; height:100%; object-fit:cover;" />
  `;

  // ปุ่มก่อนหน้า/ถัดไป
  const prevBtn = document.querySelector(".camera-controls .nav-btn:first-child");
  const nextBtn = document.querySelector(".camera-controls .nav-btn:last-child");
  prevBtn.disabled = isFirstCameraOverall;
  nextBtn.disabled = isLastCameraOverall;

  // อัปเดต timestamp เริ่มต้น
  document.getElementById("timestamp").textContent = new Date().toLocaleString();
}

function previousCamera() {
  if (currentRoomIndex === null) return;
  const totalRooms = ROOMS.length;
  if (currentRoomIndex > 0) {
    currentRoomIndex--;
  }
  updateCameraUI();
}

function nextCamera() {
  if (currentRoomIndex === null) return;
  const totalRooms = ROOMS.length;
  if (currentRoomIndex < totalRooms - 1) {
    currentRoomIndex++;
  }
  updateCameraUI();
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
    hamburgerBtn.innerHTML = "X"; // ไอคอน X (ถ้ามี)
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
  // Placeholder for statistics search functionality
  console.log("Statistics search functionality not implemented yet");
}

// 11) ALERTS PAGE ------------------------------------------

function showAlertsPage() {
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("alertsPage").classList.remove("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
}

function goBackFromAlerts() {
  document.getElementById("alertsPage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.remove("hidden");
  document.getElementById("systemConfigPage").classList.add("hidden");
}

function toggleFilter() {
  const filterSection = document.getElementById("filterSection");
  filterSection.classList.toggle("hidden");
}

function applyFilters() {
  alert("ฟีเจอร์ตัวกรองยังไม่เชื่อม API จริง"); // ตัวอย่าง alert
}

function clearFilters() {
  document.getElementById("alertTypeFilter").value = "all";
  document.getElementById("catFilter").value = "all";
  document.getElementById("dateFilter").value = "";
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

// แสดงหน้า System Config
function showSystemConfigPage() {
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("systemConfigPage").classList.remove("hidden");
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("catDetailPage").classList.add("hidden");
  document.getElementById("notificationsPage").classList.add("hidden");
}

// ฟังก์ชันโหลดข้อมูลการตั้งค่าจาก API
function loadSystemConfig() {
  fetch('/api/system_config') // เรียก API เพื่อดึงการตั้งค่าจากฐานข้อมูล
    .then((res) => res.json())
    .then((data) => {
      document.getElementById('alertNoCat').value = data.alertNoCat;
      document.getElementById('alertNoEating').value = data.alertNoEating;
      document.getElementById('minExcretion').value = data.minExcretion;
      document.getElementById('maxExcretion').value = data.maxExcretion;
      document.getElementById('minSleep').value = data.minSleep;
      document.getElementById('maxSleep').value = data.maxSleep;
      document.getElementById('maxCats').value = data.maxCats;
    })
    .catch((err) => {
      console.error('Error loading system config:', err);
      alert('เกิดข้อผิดพลาดในการโหลดการตั้งค่าจากระบบ');
    });
}

// ฟังก์ชันบันทึกการตั้งค่าลงในฐานข้อมูลผ่าน API
function saveSystemConfig() {
  const config = {
    alertNoCat: parseInt(document.getElementById('alertNoCat').value),
    alertNoEating: parseInt(document.getElementById('alertNoEating').value),
    minExcretion: parseInt(document.getElementById('minExcretion').value),
    maxExcretion: parseInt(document.getElementById('maxExcretion').value),
    minSleep: parseInt(document.getElementById('minSleep').value),
    maxSleep: parseInt(document.getElementById('maxSleep').value),
    maxCats: parseInt(document.getElementById('maxCats').value),
  };

  // ตรวจสอบค่าก่อนการบันทึก
  if (config.alertNoCat < 1 || config.alertNoCat > 48) {
    alert('Alert No Cat ต้องอยู่ระหว่าง 1-48 ชั่วโมง');
    return;
  }

  if (config.alertNoEating < 1 || config.alertNoEating > 24) {
    alert('Alert No Eating ต้องอยู่ระหว่าง 1-24 ครั้ง/วัน');
    return;
  }

  if (config.minExcretion >= config.maxExcretion) {
    alert('Minimum Excretion ต้องน้อยกว่า Maximum Excretion');
    return;
  }

  if (config.minSleep >= config.maxSleep) {
    alert('Minimum Sleep ต้องน้อยกว่า Maximum Sleep');
    return;
  }

  if (config.maxCats < 1 || config.maxCats > 50) {
    alert('Maximum Supported Cats ต้องอยู่ระหว่าง 1-50 ตัว');
    return;
  }

  // ส่งข้อมูลการตั้งค่าผ่าน API
  fetch('/api/system_config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  })
    .then((res) => res.json())
    .then((data) => {
      alert('บันทึกการตั้งค่าเรียบร้อยแล้ว');
    })
    .catch((err) => {
      console.error('Error saving system config:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า');
    });
}

// ฟังก์ชันรีเซ็ทการตั้งค่ากลับไปเป็นค่าเริ่มต้นจาก API
function resetSystemConfig() {
  if (confirm('คุณต้องการรีเซ็ทการตั้งค่าทั้งหมดเป็นค่าเริ่มต้นหรือไม่?')) {
    fetch('/api/system_config/reset', {
      method: 'POST',
    })
      .then((response) => response.json())
      .then((data) => {
        alert(data.message);  // แสดงข้อความว่ารีเซ็ทเสร็จเรียบร้อย
        loadSystemConfig();  // โหลดการตั้งค่าใหม่จากฐานข้อมูล
      })
      .catch((error) => {
        console.error('Error resetting system config:', error);
        alert('เกิดข้อผิดพลาดในการรีเซ็ทการตั้งค่า');
      });
  }
}
