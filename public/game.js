const TOTAL_TIME_MS = 20_000;
const LOOKAHEAD = 36;
const STEP_X = 54;
const STEP_Y = 31;
const STAGE_BASE_OFFSET = 168;
const RANKINGS_ENDPOINT = "/api/rankings";

const elements = {
  stage: document.querySelector("#stage"),
  startForm: document.querySelector("#startForm"),
  nickname: document.querySelector("#nickname"),
  startOverlay: document.querySelector("#startOverlay"),
  endOverlay: document.querySelector("#endOverlay"),
  endReason: document.querySelector("#endReason"),
  finalScore: document.querySelector("#finalScore"),
  restartButton: document.querySelector("#restartButton"),
  score: document.querySelector("#score"),
  timerBar: document.querySelector("#timerBar"),
  timerText: document.querySelector("#timerText"),
  stairLayer: document.querySelector("#stairLayer"),
  player: document.querySelector("#player"),
  rankingList: document.querySelector("#rankingList"),
  rankingStatus: document.querySelector("#rankingStatus"),
  refreshRankings: document.querySelector("#refreshRankings")
};

const state = {
  nickname: "",
  active: false,
  submitted: false,
  score: 0,
  startedAt: 0,
  rafId: 0,
  path: ["start"],
  positions: [{ x: 0, y: 0 }]
};

function randomDirection(previous) {
  if (!previous) return Math.random() > 0.5 ? "left" : "right";
  return Math.random() < 0.45 ? (previous === "left" ? "right" : "left") : previous;
}

function ensurePath(targetLevel) {
  while (state.path.length <= targetLevel + LOOKAHEAD) {
    const previous = state.path[state.path.length - 1] === "start" ? null : state.path[state.path.length - 1];
    const next = randomDirection(previous);
    const lastPosition = state.positions[state.positions.length - 1];
    state.path.push(next);
    state.positions.push({
      x: lastPosition.x + (next === "left" ? -1 : 1),
      y: lastPosition.y + 1
    });
  }
}

function createStair(level) {
  const stair = document.createElement("span");
  const offset = level - state.score;
  const current = state.positions[state.score];
  const position = state.positions[level];
  const nextDirection = state.path[level + 1];

  stair.className = "stair";
  if (level === state.score) stair.classList.add("current");
  if (level > state.score && level <= state.score + 3) {
    stair.classList.add(nextDirection === "left" ? "next-left" : "next-right");
  }

  stair.style.setProperty("--x", `${(position.x - current.x) * STEP_X}px`);
  stair.style.setProperty("--y", `${elements.stage.clientHeight - STAGE_BASE_OFFSET - offset * STEP_Y}px`);
  stair.style.zIndex = String(100 - offset);
  return stair;
}

function renderStairs() {
  ensurePath(state.score + LOOKAHEAD);
  const fragment = document.createDocumentFragment();
  const start = Math.max(0, state.score - 2);
  const end = state.score + 18;

  for (let level = end; level >= start; level -= 1) {
    fragment.append(createStair(level));
  }

  elements.stairLayer.replaceChildren(fragment);
}

function setScore(score) {
  state.score = score;
  elements.score.textContent = String(score);
  renderStairs();
}

function setPlayerStep(direction) {
  elements.player.classList.remove("step-left", "step-right");
  void elements.player.offsetWidth;
  elements.player.classList.add(direction === "left" ? "step-left" : "step-right");
  window.setTimeout(() => {
    elements.player.classList.remove("step-left", "step-right");
  }, 120);
}

function updateTimer() {
  if (!state.active) return;

  const elapsed = performance.now() - state.startedAt;
  const remaining = Math.max(0, TOTAL_TIME_MS - elapsed);
  const ratio = remaining / TOTAL_TIME_MS;

  elements.timerText.textContent = (remaining / 1000).toFixed(1);
  elements.timerBar.style.transform = `scaleX(${ratio})`;

  if (remaining <= 0) {
    endGame("TIME UP");
    return;
  }

  state.rafId = requestAnimationFrame(updateTimer);
}

function canMove(direction, count) {
  for (let step = 1; step <= count; step += 1) {
    if (state.path[state.score + step] !== direction) {
      return false;
    }
  }
  return true;
}

function attemptMove(direction, count) {
  if (!state.active) return;
  ensurePath(state.score + count + LOOKAHEAD);

  if (!canMove(direction, count)) {
    elements.player.classList.add("fall");
    endGame("WRONG WAY");
    return;
  }

  setPlayerStep(direction);
  setScore(state.score + count);
}

function resetGame({ showMenu = false } = {}) {
  cancelAnimationFrame(state.rafId);
  state.active = false;
  state.submitted = false;
  state.score = 0;
  state.startedAt = 0;
  state.path = ["start"];
  state.positions = [{ x: 0, y: 0 }];
  elements.player.classList.remove("fall", "step-left", "step-right");
  elements.timerText.textContent = "20.0";
  elements.timerBar.style.transform = "scaleX(1)";
  elements.endOverlay.classList.add("hidden");
  elements.stage.classList.toggle("is-menu", showMenu);
  setScore(0);
}

function startGame(nickname) {
  resetGame();
  state.nickname = nickname;
  state.active = true;
  state.startedAt = performance.now();
  elements.startOverlay.classList.add("hidden");
  elements.stage.classList.remove("is-menu");
  elements.stage.focus();
  updateTimer();
}

async function endGame(reason) {
  if (!state.active) return;

  state.active = false;
  cancelAnimationFrame(state.rafId);
  elements.endReason.textContent = reason;
  elements.finalScore.textContent = String(state.score);
  elements.endOverlay.classList.remove("hidden");

  if (!state.submitted) {
    state.submitted = true;
    await submitScore();
  }
}

async function submitScore() {
  const elapsedMs = Math.min(TOTAL_TIME_MS, Math.round(performance.now() - state.startedAt));

  try {
    elements.rankingStatus.textContent = "점수를 등록하는 중...";
    const response = await fetch(RANKINGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: state.nickname,
        score: state.score,
        elapsedMs
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "점수 저장에 실패했습니다.");
    await loadRankings("점수가 등록되었습니다.");
  } catch (error) {
    elements.rankingStatus.textContent = error.message || "점수 등록에 실패했습니다. 서버를 확인해 주세요.";
  }
}

async function loadRankings(successMessage = "새로고침 완료") {
  elements.rankingStatus.textContent = "랭킹을 불러오는 중...";
  elements.refreshRankings.disabled = true;

  try {
    const response = await fetch(`${RANKINGS_ENDPOINT}?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "랭킹을 불러올 수 없습니다.");
    renderRankings(data.rankings || []);
    elements.rankingStatus.textContent = data.rankings?.length ? successMessage : "아직 등록된 기록이 없습니다.";
  } catch (error) {
    elements.rankingStatus.textContent = error.message || "랭킹 서버에 연결할 수 없습니다.";
  } finally {
    elements.refreshRankings.disabled = false;
  }
}

function renderRankings(rankings) {
  if (!rankings.length) {
    elements.rankingList.replaceChildren();
    elements.rankingStatus.textContent = "아직 등록된 기록이 없습니다.";
    return;
  }

  const fragment = document.createDocumentFragment();
  rankings.slice(0, 10).forEach((entry, index) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <span class="rank-num">${index + 1}</span>
      <span class="rank-name"></span>
      <span class="rank-score">${entry.score}F</span>
    `;
    item.querySelector(".rank-name").textContent = entry.nickname;
    fragment.append(item);
  });

  elements.rankingList.replaceChildren(fragment);
}

function handleKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();

  const direction = event.key === "ArrowLeft" ? "left" : "right";
  attemptMove(direction, event.shiftKey ? 2 : 1);
}

elements.startForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nickname = elements.nickname.value.trim();
  if (!nickname) return;
  startGame(nickname);
});

elements.restartButton.addEventListener("click", () => {
  resetGame({ showMenu: true });
  elements.startOverlay.classList.remove("hidden");
  elements.nickname.focus();
});

elements.refreshRankings.addEventListener("click", () => loadRankings());
window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", renderStairs);

resetGame({ showMenu: true });
loadRankings();
