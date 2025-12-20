if (localStorage.getItem("introPlayed") === "true") {
    window.location.replace("web.html");
}



/* =====================
   ELEMENT REFERENCES
====================== */

const bgMusic = document.getElementById("bgMusic");

const titles = [
  document.getElementById("title1"),
  document.getElementById("title2"),
  document.getElementById("title3"),
  document.getElementById("title4"),
  document.getElementById("title5"), // AURA
  document.getElementById("title6")  // Closing
];

const countdownEl = document.getElementById("countdown");
const launchBtn = document.getElementById("launchBtn");

/* ======================
   INITIAL STATE
====================== */

launchBtn.style.opacity = "0";
launchBtn.style.pointerEvents = "none";
countdownEl.style.opacity = "0";

/* ======================
   ADMIN DATA
====================== */

const DEFAULT_PASSWORD = "Emo123@Reygriff";

let adminUnlocked = localStorage.getItem("adminUnlocked") === "true";
let adminName = localStorage.getItem("adminName");
let adminPassword = localStorage.getItem("adminPassword") || DEFAULT_PASSWORD;

/* ======================
   SCENES
====================== */

const scenes = [
  { name: "Vived Games", index: 0, music: 0 },
  { name: "Song By MVSTERIOUS", index: 1, music: 2 },
  { name: "Site Made By VVX, Reygriff", index: 2, music: 6 },
  { name: "Vived Games® | Games are the player's flames", index: 3, music: 12 },
  { name: "Games Filled With AURA Are Coming Soon", index: 4, music: 31 },
  { name: "Window Closing By Its Own", index: 5, music: 60 }
];

/* ======================
   STATE
====================== */

let timers = [];
let started = false;

/* ======================
   HELPERS
====================== */

function clearTimers() {
  timers.forEach(t => clearTimeout(t));
  timers = [];
}

function hideAll() {
  titles.forEach(t => t.classList.remove("show"));
  launchBtn.style.opacity = "0";
  launchBtn.style.pointerEvents = "none";
  countdownEl.classList.remove("show");
  countdownEl.style.opacity = "0";
}

/* ======================
   TITLE CONTROL
====================== */

function showTitle(i) {
  hideAll();
  titles[i].classList.add("show");

  // Show launch button only on AURA
  if (i === 4) {
    setTimeout(() => {
      launchBtn.style.opacity = "1";
      launchBtn.style.pointerEvents = "auto";
    }, 400);
  }

  // If closing scene → start countdown
  if (i === 5) {
    startClosingCountdown();
  }
}

/* ======================
   INTRO SEQUENCE
====================== */

function startIntro(fromIndex = 0, musicTime = 0) {
  clearTimers();
  started = true;

  bgMusic.currentTime = musicTime;
  bgMusic.volume = 1;
  bgMusic.play().catch(() => {});

  let i = fromIndex;
  showTitle(i);

  function next() {
    if (i < titles.length - 1) {
      titles[i].classList.remove("show");
      i++;

      timers.push(setTimeout(() => showTitle(i), 1200));
      timers.push(setTimeout(next, 3500));
    }
  }

  timers.push(setTimeout(next, 3500));
}

/* ======================
   WINDOW CLOSING + COUNTDOWN
====================== */

function startClosingCountdown() {
  countdownEl.textContent = "5";
  countdownEl.classList.add("show");
  countdownEl.style.opacity = "1";

  let count = 5;
  const step = bgMusic.volume / count;

  const interval = setInterval(() => {
    count--;
    countdownEl.textContent = count;
    bgMusic.volume = Math.max(0, bgMusic.volume - step);

    if (count === 0) {
      clearInterval(interval);
      window.close();
    }
  }, 1000);
}

/* ======================
   CLICK TO START INTRO
====================== */

document.addEventListener("click", e => {
  if (started) return;
  if (e.target.closest("button")) return;
  startIntro(0, 0);
});

/* ======================
   LAUNCH WEBSITE
====================== */

launchBtn.onclick = () => {
  document.body.style.transition = "transform 0.8s ease";
  document.body.style.transform = "translateX(-100%)";

  setTimeout(() => {
    window.location.href = "web.html";
  }, 800);
};

/* ======================
   ADMIN PANEL
====================== */

function openAdmin() {
  if (!adminUnlocked) {
    const pass = prompt("Enter Admin Password:");
    if (pass !== adminPassword) return alert("Access Denied");

    adminUnlocked = true;
    localStorage.setItem("adminUnlocked", "true");

    if (!adminName) {
      adminName = prompt("Enter Admin Name:");
      localStorage.setItem("adminName", adminName || "Admin");
    }
  }

  document.getElementById("adminInfo").textContent =
    "Logged in as: " + adminName;

  document.getElementById("adminPanel").style.display = "block";
  loadScenes();
}

function loadScenes() {
  const grid = document.getElementById("sceneGrid");
  grid.innerHTML = "";

  scenes.forEach(scene => {
    const card = document.createElement("div");
    card.className = "scene-card";
    card.innerHTML = `<div class="scene-img">${scene.name}</div>`;
    card.onclick = () => {
      document.getElementById("adminPanel").style.display = "none";
      startIntro(scene.index, scene.music);
    };
    grid.appendChild(card);
  });
}

function searchScenes() {
  const input = document.getElementById("sceneSearch").value.toLowerCase();
  [...document.querySelectorAll(".scene-card")].forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(input)
      ? "block"
      : "none";
  });
}

function changePassword() {
  const oldPass = prompt("Enter old password:");
  if (oldPass !== adminPassword) return alert("Wrong password");

  const newPass = prompt("Enter new password:");
  if (!newPass) return;

  adminPassword = newPass;
  localStorage.setItem("adminPassword", newPass);
  alert("Password updated");
}

function logoutAdmin() {
  localStorage.removeItem("adminUnlocked");
  adminUnlocked = false;
  document.getElementById("adminPanel").style.display = "none";
}
