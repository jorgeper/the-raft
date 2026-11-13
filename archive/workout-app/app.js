/* ========================================
   Workout Book — App Logic (Redesigned)
   ======================================== */

(function () {
  'use strict';

  // ========================================
  // Storage keys
  // ========================================
  const KEYS = {
    days: 'wb_days',
    savedWorkouts: 'wb_saved_workouts',
    settings: 'wb_settings',
  };

  // Old keys for migration
  const OLD_KEYS = {
    workouts: 'wb_workouts',
    templates: 'wb_templates',
  };

  // ========================================
  // State
  // ========================================
  let state = {
    days: [],            // Array of DayRecord objects
    savedWorkouts: [],   // Array of SavedWorkout objects
    settings: { weightUnit: 'lb', theme: 'dark', devMode: false },
    currentDate: null,   // YYYY-MM-DD string for the day screen
    monthViewDate: null, // YYYY-MM-DD anchoring the displayed month
    viewMode: 'day',     // 'day' or 'month'
    timerInterval: null,
    library: [],                     // loaded exercise library
    libraryFilters: {},              // active filters { movementPattern: 'Push', muscleGroup: null, ... }
    librarySearch: '',               // search query for library browser
    editingWorkout: null,           // saved workout being edited
    editingWorkoutExercises: [],    // exercises while editing
    analyticsExercises: [],          // selected exercises for analytics charts
  };

  // ========================================
  // Helpers
  // ========================================
  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : (
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      })
    );
  }

  function toDateStr(d) {
    const date = d instanceof Date ? d : new Date(d);
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function prevDateStr(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return toDateStr(d);
  }

  function nextDateStr(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return toDateStr(d);
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function formatTimerMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    return String(hours).padStart(2, '0') + ':' +
      String(min).padStart(2, '0') + ':' +
      String(sec).padStart(2, '0');
  }

  function formatSetsCompact(sets) {
    if (sets.length === 0) return 'No sets';
    const groups = [];
    let currentWeight = null;
    let currentReps = [];
    sets.forEach(s => {
      if (s.weight !== currentWeight) {
        if (currentWeight !== null) {
          groups.push({ weight: currentWeight, reps: currentReps });
        }
        currentWeight = s.weight;
        currentReps = [s.reps];
      } else {
        currentReps.push(s.reps);
      }
    });
    if (currentWeight !== null) {
      groups.push({ weight: currentWeight, reps: currentReps });
    }
    return groups.map(g => `${g.weight} ${unit()} &times; ${g.reps.join(', ')}`).join(' &nbsp;|&nbsp; ');
  }

  // ========================================
  // Theme
  // ========================================
  function applyTheme() {
    const theme = state.settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#f6f4f0' : '#09090b');
    }
  }

  // ========================================
  // Persistence
  // ========================================
  function save() {
    localStorage.setItem(KEYS.days, JSON.stringify(state.days));
    localStorage.setItem(KEYS.savedWorkouts, JSON.stringify(state.savedWorkouts));
    localStorage.setItem(KEYS.settings, JSON.stringify(state.settings));
  }

  function load() {
    let migrated = false;

    // Migrate old keys if present
    try {
      const oldWorkouts = localStorage.getItem(OLD_KEYS.workouts);
      if (oldWorkouts && !localStorage.getItem(KEYS.days)) {
        const workouts = JSON.parse(oldWorkouts);
        // Convert old Workout objects to DayRecord format
        state.days = workouts.map(w => ({
          id: w.id,
          date: w.date,
          workoutName: w.templateName || null,
          exercises: w.exercises,
          timerState: w.endTime ? 'stopped' : 'idle',
          timerStartedAt: w.startTime || null,
          timerElapsedMs: w.startTime && w.endTime
            ? new Date(w.endTime).getTime() - new Date(w.startTime).getTime()
            : 0,
          timerStoppedAt: w.endTime || null,
        }));
        migrated = true;
      }
    } catch (e) { /* ignore */ }

    try {
      const oldTemplates = localStorage.getItem(OLD_KEYS.templates);
      if (oldTemplates && !localStorage.getItem(KEYS.savedWorkouts)) {
        state.savedWorkouts = JSON.parse(oldTemplates);
        migrated = true;
      }
    } catch (e) { /* ignore */ }

    if (migrated) {
      save();
      // Clean up old keys after successful migration
      localStorage.removeItem(OLD_KEYS.workouts);
      localStorage.removeItem(OLD_KEYS.templates);
    }

    // Load from new keys
    try {
      const d = localStorage.getItem(KEYS.days);
      if (d) state.days = JSON.parse(d);
    } catch (e) { /* ignore */ }
    try {
      const sw = localStorage.getItem(KEYS.savedWorkouts);
      if (sw) state.savedWorkouts = JSON.parse(sw);
    } catch (e) { /* ignore */ }
    try {
      const s = localStorage.getItem(KEYS.settings);
      if (s) state.settings = JSON.parse(s);
    } catch (e) { /* ignore */ }
  }

  // ========================================
  // Data queries
  // ========================================
  function getDayRecord(dateStr) {
    return state.days.find(d => d.date === dateStr) || null;
  }

  function getOrCreateDayRecord(dateStr) {
    let day = getDayRecord(dateStr);
    if (!day) {
      day = {
        id: uuid(),
        date: dateStr,
        workoutName: null,
        exercises: [],
        timerState: 'idle',
        timerStartedAt: null,
        timerElapsedMs: 0,
        timerStoppedAt: null,
      };
      state.days.push(day);
      save();
    }
    return day;
  }

  function getLastSession(exerciseName, excludeDate) {
    const name = exerciseName.toLowerCase();
    for (let i = state.days.length - 1; i >= 0; i--) {
      const d = state.days[i];
      if (excludeDate && d.date === excludeDate) continue;
      const ex = d.exercises.find(e => e.exerciseName.toLowerCase() === name);
      if (ex && ex.sets.length > 0) {
        const maxWeight = Math.max(...ex.sets.map(s => s.weight));
        const firstSet = ex.sets[0];
        return { weight: firstSet.weight, reps: firstSet.reps, maxWeight };
      }
    }
    return null;
  }

  function getTrend(exerciseName, excludeDate) {
    const name = exerciseName.toLowerCase();
    const weights = [];
    for (let i = state.days.length - 1; i >= 0 && weights.length < 3; i--) {
      const d = state.days[i];
      if (excludeDate && d.date === excludeDate) continue;
      const ex = d.exercises.find(e => e.exerciseName.toLowerCase() === name);
      if (ex && ex.sets.length > 0) {
        weights.push(Math.max(...ex.sets.map(s => s.weight)));
      }
    }
    if (weights.length < 2) return 'flat';
    if (weights[0] > weights[weights.length - 1]) return 'up';
    if (weights[0] < weights[weights.length - 1]) return 'down';
    return 'flat';
  }

  function getTrendArrow(exerciseName, excludeDate) {
    const t = getTrend(exerciseName, excludeDate);
    if (t === 'up') return '<span class="trend-up">&uarr;</span>';
    if (t === 'down') return '<span class="trend-down">&darr;</span>';
    return '<span class="trend-flat">&rarr;</span>';
  }

  function getAllExerciseNames() {
    const names = new Map();
    // Include library exercises first
    state.library.forEach(e => {
      const lower = e.name.toLowerCase();
      if (!names.has(lower)) {
        names.set(lower, e.name);
      }
    });
    // Then user's logged exercises
    state.days.forEach(d => {
      d.exercises.forEach(e => {
        const lower = e.exerciseName.toLowerCase();
        if (!names.has(lower)) {
          names.set(lower, e.exerciseName);
        }
      });
    });
    return Array.from(names.values());
  }

  // ========================================
  // Analytics data helpers
  // ========================================
  function getExerciseHistory(exerciseName) {
    const name = exerciseName.toLowerCase();
    const history = [];
    state.days.forEach(day => {
      const ex = day.exercises.find(e => e.exerciseName.toLowerCase() === name);
      if (ex && ex.sets.length > 0) {
        const maxWeight = Math.max(...ex.sets.map(s => s.weight));
        const totalVolume = ex.sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
        history.push({ date: day.date, maxWeight, totalVolume });
      }
    });
    history.sort((a, b) => a.date.localeCompare(b.date));
    return history;
  }

  function getPersonalRecords() {
    const records = new Map();
    state.days.forEach(day => {
      day.exercises.forEach(ex => {
        if (ex.sets.length === 0) return;
        const maxWeight = Math.max(...ex.sets.map(s => s.weight));
        const name = ex.exerciseName;
        const lower = name.toLowerCase();
        if (!records.has(lower) || maxWeight > records.get(lower).maxWeight) {
          records.set(lower, { name, maxWeight });
        }
      });
    });
    return Array.from(records.values())
      .sort((a, b) => b.maxWeight - a.maxWeight)
      .slice(0, 5);
  }

  function getWorkoutStats() {
    const datesWithExercises = [];
    const exerciseNames = new Set();
    state.days.forEach(day => {
      if (day.exercises.length > 0) {
        datesWithExercises.push(day.date);
        day.exercises.forEach(ex => exerciseNames.add(ex.exerciseName.toLowerCase()));
      }
    });
    datesWithExercises.sort();

    let bestStreak = 0;
    let currentStreak = 0;
    for (let i = 0; i < datesWithExercises.length; i++) {
      if (i === 0) {
        currentStreak = 1;
      } else {
        const prev = new Date(datesWithExercises[i - 1] + 'T12:00:00');
        const curr = new Date(datesWithExercises[i] + 'T12:00:00');
        const diffDays = (curr - prev) / 86400000;
        currentStreak = diffDays === 1 ? currentStreak + 1 : 1;
      }
      bestStreak = Math.max(bestStreak, currentStreak);
    }

    return {
      totalDays: datesWithExercises.length,
      uniqueExercises: exerciseNames.size,
      bestStreak,
    };
  }

  function unit() {
    return state.settings.weightUnit || 'lb';
  }

  // ========================================
  // Timer logic
  // ========================================
  function getElapsedMs(day) {
    if (!day) return 0;
    if (day.timerState === 'idle' || day.timerState === 'stopped') return day.timerElapsedMs;
    // running: accumulated + current segment
    const now = Date.now();
    const segmentMs = now - new Date(day.timerStartedAt).getTime();
    return day.timerElapsedMs + segmentMs;
  }

  function startTimer(day) {
    day.timerState = 'running';
    day.timerStartedAt = new Date().toISOString();
    save();
    startTimerInterval();
    renderTimerControls(day);
  }

  function stopTimer(day) {
    if (day.timerState === 'running') {
      const now = Date.now();
      const segmentMs = now - new Date(day.timerStartedAt).getTime();
      day.timerElapsedMs += segmentMs;
    }
    day.timerState = 'stopped';
    day.timerStoppedAt = new Date().toISOString();
    day.timerStartedAt = null;
    save();
    stopTimerInterval();
    renderTimerControls(day);
  }

  function resetTimer(day) {
    day.timerState = 'idle';
    day.timerStartedAt = null;
    day.timerElapsedMs = 0;
    day.timerStoppedAt = null;
    save();
    stopTimerInterval();
    renderTimerControls(day);
  }

  function startTimerInterval() {
    stopTimerInterval();
    state.timerInterval = setInterval(() => {
      const day = getDayRecord(state.currentDate);
      if (day && day.timerState === 'running') {
        $('timer-display').textContent = formatTimerMs(getElapsedMs(day));
      }
    }, 1000);
  }

  function stopTimerInterval() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // ========================================
  // DOM helpers
  // ========================================
  function $(id) {
    return document.getElementById(id);
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = $('screen-' + name);
    if (screen) screen.classList.add('active');

    // Map sub-screens to their parent nav item
    const navMap = { 'library': 'settings', 'exercise-detail': 'settings' };
    const navTarget = navMap[name] || name;
    document.querySelectorAll('.nav-item').forEach(btn => {
      const target = btn.dataset.screen;
      btn.classList.toggle('active', target === navTarget);
    });
  }

  function showModal(id) {
    $(id).classList.add('active');
  }

  function hideModal(id) {
    $(id).classList.remove('active');
  }

  // ========================================
  // Render: Day Screen
  // ========================================
  function renderDay(dateStr) {
    state.currentDate = dateStr;
    stopTimerInterval();

    const isToday = dateStr === todayStr();
    const dateEl = $('day-date');
    dateEl.textContent = isToday ? 'Today' : formatDateShort(dateStr);
    dateEl.classList.toggle('is-today', isToday);

    // Show/hide "Today" jump button
    $('btn-go-today').classList.toggle('hidden', isToday);

    const day = getDayRecord(dateStr);
    const hasExercises = day && day.exercises.length > 0;

    // Workout name label
    if (day && day.workoutName) {
      $('day-workout-name').textContent = day.workoutName;
      $('day-workout-name').classList.remove('hidden');
    } else {
      $('day-workout-name').classList.add('hidden');
    }

    // Empty message
    $('day-empty-msg').classList.toggle('hidden', hasExercises);

    // Exercise list
    const container = $('day-exercises');
    if (!hasExercises) {
      container.innerHTML = '';
    } else {
      const exCount = day.exercises.length;
      container.innerHTML = day.exercises.map((ex, exIdx) => {
        const last = getLastSession(ex.exerciseName, dateStr);
        const trendHtml = last ? getTrendArrow(ex.exerciseName, dateStr) : '';
        const lastText = last ? `Last: ${last.weight} ${unit()} &times; ${last.reps}` : 'First time!';

        const setsHtml = ex.sets.map((s, sIdx) => `
          <div class="set-row">
            <span class="set-label">Set ${sIdx + 1}</span>
            <input type="number" class="input-inline set-weight" data-ex="${exIdx}" data-set="${sIdx}" value="${s.weight}" inputmode="decimal" min="0" step="any">
            <span class="set-unit">${unit()}</span>
            <span class="set-separator">&times;</span>
            <input type="number" class="input-inline set-reps" data-ex="${exIdx}" data-set="${sIdx}" value="${s.reps}" inputmode="numeric" min="0">
            <button class="set-remove" data-ex="${exIdx}" data-set="${sIdx}">&times;</button>
          </div>
        `).join('');

        const libEx = getLibraryExercise(ex.exerciseName);
        const pillsHtml = libEx ? `<div class="exercise-pills">${renderPills(libEx)}</div>` : '';

        return `
          <div class="exercise-card" data-ex="${exIdx}">
            <div class="exercise-header">
              <span class="exercise-name">${ex.exerciseName}</span>
              <div class="exercise-header-actions">
                <button class="exercise-move move-up" data-ex="${exIdx}" ${exIdx === 0 ? 'disabled' : ''}>&uarr;</button>
                <button class="exercise-move move-down" data-ex="${exIdx}" ${exIdx === exCount - 1 ? 'disabled' : ''}>&darr;</button>
                <button class="exercise-remove" data-ex="${exIdx}">&times;</button>
              </div>
            </div>
            ${pillsHtml}
            <div class="exercise-last">${lastText} ${trendHtml}</div>
            <div class="sets-list">${setsHtml}</div>
            <button class="btn-add-set" data-ex="${exIdx}">+ Add Set</button>
          </div>
        `;
      }).join('');
    }

    // Timer
    renderTimerControls(day);

    // If the timer is running for this day, start the interval
    if (day && day.timerState === 'running') {
      startTimerInterval();
    }

    showDayView();
    showScreen('day');
  }

  function renderTimerControls(day) {
    const display = $('timer-display');
    const btnStart = $('btn-timer-start');
    const btnStop = $('btn-timer-stop');
    const btnReset = $('btn-timer-reset');

    const timerState = day ? day.timerState : 'idle';
    const elapsed = getElapsedMs(day);

    display.textContent = formatTimerMs(elapsed);
    display.classList.toggle('timer-stopped', timerState === 'stopped');

    // Hide all buttons first
    btnStart.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnReset.classList.add('hidden');

    switch (timerState) {
      case 'idle':
        btnStart.classList.remove('hidden');
        break;
      case 'running':
        btnStop.classList.remove('hidden');
        break;
      case 'stopped':
        btnStart.classList.remove('hidden');
        btnReset.classList.remove('hidden');
        break;
    }
  }

  // ========================================
  // Month View
  // ========================================
  function showDayView() {
    state.viewMode = 'day';
    $('day-view').classList.remove('hidden');
    $('month-view').classList.add('hidden');
  }

  function showMonthView() {
    state.viewMode = 'month';
    state.monthViewDate = state.currentDate || todayStr();
    $('day-view').classList.add('hidden');
    $('month-view').classList.remove('hidden');
    renderMonth();
    showScreen('day');
  }

  function renderMonth() {
    const anchor = state.monthViewDate || todayStr();
    const anchorDate = new Date(anchor + 'T12:00:00');
    const year = anchorDate.getFullYear();
    const month = anchorDate.getMonth();

    // Title
    const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    $('month-title').textContent = monthName;

    // Build set of dates that have workouts
    const workoutDates = new Set();
    state.days.forEach(d => {
      if (d.exercises && d.exercises.length > 0) {
        workoutDates.add(d.date);
      }
    });

    const today = todayStr();
    const selected = state.currentDate;

    // First day of month & padding
    const firstOfMonth = new Date(year, month, 1);
    const startDow = firstOfMonth.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Previous month padding
    const prevMonthDays = new Date(year, month, 0).getDate();

    // Build grid
    let html = '';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(d => {
      html += `<div class="month-grid-header">${d}</div>`;
    });

    // Previous month trailing days
    for (let i = startDow - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const dateStr = toDateStr(new Date(year, month - 1, dayNum));
      const hasDot = workoutDates.has(dateStr);
      html += `<div class="month-day other-month" data-date="${dateStr}">
        <span class="month-day-number">${dayNum}</span>
        ${hasDot ? '<span class="month-day-dot"></span>' : ''}
      </div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateStr(new Date(year, month, d));
      const isToday = dateStr === today;
      const isSelected = dateStr === selected;
      const hasDot = workoutDates.has(dateStr);
      const classes = ['month-day'];
      if (isToday) classes.push('is-today');
      if (isSelected) classes.push('is-selected');

      html += `<div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="month-day-number">${d}</span>
        ${hasDot ? '<span class="month-day-dot"></span>' : ''}
      </div>`;
    }

    // Next month padding (fill to complete last row)
    const totalCells = startDow + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
      for (let d = 1; d <= 7 - remainder; d++) {
        const dateStr = toDateStr(new Date(year, month + 1, d));
        const hasDot = workoutDates.has(dateStr);
        html += `<div class="month-day other-month" data-date="${dateStr}">
          <span class="month-day-number">${d}</span>
          ${hasDot ? '<span class="month-day-dot"></span>' : ''}
        </div>`;
      }
    }

    $('month-grid').innerHTML = html;

    // Hide "Today" button if current month already contains today
    const todayDate = new Date(today + 'T12:00:00');
    const isCurrentMonth = todayDate.getFullYear() === year && todayDate.getMonth() === month;
    $('btn-month-today').classList.toggle('hidden', isCurrentMonth);
  }

  // ========================================
  // Exercise Library
  // ========================================

  const LIBRARY_STORAGE_KEY = 'wb_exercise_library';

  function loadDefaultLibrary() {
    return fetch('default-library.json')
      .then(r => r.json())
      .then(data => {
        state.library = data.exercises || [];
        localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(data));
      })
      .catch(() => {
        state.library = [];
      });
  }

  function loadLibrary() {
    try {
      const stored = localStorage.getItem(LIBRARY_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        state.library = data.exercises || [];
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function getLibraryExercise(name) {
    return state.library.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
  }

  function renderPills(exercise) {
    let html = '';
    if (exercise.movementPattern) html += `<span class="pill pill-movement">${exercise.movementPattern}</span>`;
    if (exercise.muscleGroup) html += `<span class="pill pill-muscle">${exercise.muscleGroup}</span>`;
    if (exercise.exerciseType) html += `<span class="pill pill-type">${exercise.exerciseType}</span>`;
    if (exercise.equipment) html += `<span class="pill pill-equipment">${exercise.equipment}</span>`;
    if (exercise.calisthenics) html += `<span class="pill pill-calisthenics">Calisthenics</span>`;
    return html;
  }

  // ========================================
  // Library Browser
  // ========================================

  function renderLibrary() {
    // Build filter chips
    renderLibraryFilters();
    renderLibraryList();
    showScreen('library');
  }

  function renderLibraryFilters() {
    const movements = [...new Set(state.library.map(e => e.movementPattern).filter(Boolean))].sort();
    const muscles = [...new Set(state.library.map(e => e.muscleGroup).filter(Boolean))].sort();
    const types = [...new Set(state.library.map(e => e.exerciseType).filter(Boolean))].sort();
    const equipment = [...new Set(state.library.map(e => e.equipment).filter(Boolean))].sort();

    const f = state.libraryFilters;

    $('filter-movement').innerHTML = movements.map(v =>
      `<button class="filter-chip${f.movementPattern === v ? ' active' : ''}" data-category="movementPattern" data-value="${v}">${v}</button>`
    ).join('');

    $('filter-muscle').innerHTML = muscles.map(v =>
      `<button class="filter-chip${f.muscleGroup === v ? ' active' : ''}" data-category="muscleGroup" data-value="${v}">${v}</button>`
    ).join('');

    $('filter-type').innerHTML = types.map(v =>
      `<button class="filter-chip${f.exerciseType === v ? ' active' : ''}" data-category="exerciseType" data-value="${v}">${v}</button>`
    ).join('');

    $('filter-equipment').innerHTML = equipment.map(v =>
      `<button class="filter-chip${f.equipment === v ? ' active' : ''}" data-category="equipment" data-value="${v}">${v}</button>`
    ).join('');

    $('filter-calisthenics').innerHTML =
      `<button class="filter-chip${f.calisthenics === true ? ' active' : ''}" data-category="calisthenics" data-value="true">Calisthenics</button>`;
  }

  function renderLibraryList() {
    const q = state.librarySearch.toLowerCase().trim();
    const f = state.libraryFilters;

    let exercises = state.library.filter(ex => {
      if (q && !ex.name.toLowerCase().includes(q)) return false;
      if (f.movementPattern && ex.movementPattern !== f.movementPattern) return false;
      if (f.muscleGroup && ex.muscleGroup !== f.muscleGroup) return false;
      if (f.exerciseType && ex.exerciseType !== f.exerciseType) return false;
      if (f.equipment && ex.equipment !== f.equipment) return false;
      if (f.calisthenics === true && !ex.calisthenics) return false;
      return true;
    });

    exercises.sort((a, b) => a.name.localeCompare(b.name));

    $('library-count').textContent = exercises.length + ' exercise' + (exercises.length !== 1 ? 's' : '');
    $('library-empty').classList.toggle('hidden', exercises.length > 0);

    $('library-list').innerHTML = exercises.map(ex => `
      <div class="library-item" data-name="${ex.name}">
        <div class="library-item-name">${ex.name}</div>
        <div class="library-item-pills">${renderPills(ex)}</div>
      </div>
    `).join('');
  }

  function renderExerciseDetail(name) {
    const ex = getLibraryExercise(name);
    if (!ex) return;

    $('detail-exercise-name').textContent = ex.name;
    $('detail-description').textContent = ex.description || '';
    $('detail-pills').innerHTML = renderPills(ex);

    const altList = $('detail-alternatives-list');
    if (ex.alternatives && ex.alternatives.length > 0) {
      $('detail-alternatives').classList.remove('hidden');
      altList.innerHTML = ex.alternatives.map(alt => {
        const altEx = getLibraryExercise(alt);
        const inLibrary = !!altEx;
        return `<div class="detail-alt-item${inLibrary ? '' : ' no-link'}" data-name="${alt}">
          <span class="detail-alt-name">${alt}</span>
          ${inLibrary ? '<span class="detail-alt-chevron">&#9654;</span>' : ''}
        </div>`;
      }).join('');
    } else {
      $('detail-alternatives').classList.add('hidden');
      altList.innerHTML = '';
    }

    showScreen('exercise-detail');
  }

  function importLibrary(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (data.exercises && Array.isArray(data.exercises)) {
          state.library = data.exercises;
          localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(data));
        }
      } catch (err) {
        // invalid file
      }
    };
    reader.readAsText(file);
  }

  function exportLibrary() {
    const stored = localStorage.getItem(LIBRARY_STORAGE_KEY);
    const data = stored || JSON.stringify({ version: '1.0.0', exercises: state.library });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exercise-library.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ========================================
  // Add Exercise to Day
  // ========================================
  function openAddExercise() {
    $('exercise-search').value = '';
    renderSuggestions('');
    showModal('modal-add-exercise');
    setTimeout(() => $('exercise-search').focus(), 100);
  }

  function renderSuggestions(query) {
    const allNames = getAllExerciseNames();
    const q = query.toLowerCase().trim();

    const day = getDayRecord(state.currentDate);
    const currentNames = day
      ? new Set(day.exercises.map(e => e.exerciseName.toLowerCase()))
      : new Set();

    let filtered = allNames.filter(n => !currentNames.has(n.toLowerCase()));
    if (q) {
      filtered = filtered.filter(n => n.toLowerCase().includes(q));
    }

    // Update create button text
    const createBtn = $('btn-create-exercise');
    if (q) {
      createBtn.textContent = `Add "${query.trim()}"`;
      createBtn.classList.remove('hidden');
    } else {
      createBtn.textContent = 'Create new exercise';
      createBtn.classList.add('hidden');
    }

    const container = $('exercise-suggestions');
    if (filtered.length === 0 && !q) {
      container.innerHTML = '<p class="hint-text">Type an exercise name above.</p>';
      return;
    }

    container.innerHTML = filtered.map(name => {
      const last = getLastSession(name, state.currentDate);
      const meta = last
        ? `${last.weight} ${unit()} ${getTrendArrow(name, state.currentDate)}`
        : '';
      const libEx = getLibraryExercise(name);
      const pillsRow = libEx ? `<div class="suggestion-pills">${renderPills(libEx)}</div>` : '';
      return `
        <div class="suggestion-item" data-name="${name}">
          <div class="suggestion-item-info">
            <span class="suggestion-name">${name}</span>
            ${pillsRow}
          </div>
          <span class="suggestion-meta">${meta}</span>
        </div>
      `;
    }).join('');
  }

  function addExerciseToDay(name) {
    const day = getOrCreateDayRecord(state.currentDate);
    const last = getLastSession(name, state.currentDate);
    const sets = last ? [{ weight: last.weight, reps: last.reps }] : [];

    day.exercises.push({
      id: uuid(),
      exerciseName: name,
      sets: sets,
    });
    save();
    hideModal('modal-add-exercise');
    renderDay(state.currentDate);
  }

  function createNewExercise() {
    const name = $('exercise-search').value.trim();
    if (!name) {
      $('exercise-search').focus();
      return;
    }
    addExerciseToDay(name);
  }

  // ========================================
  // Load Workout
  // ========================================
  function openLoadWorkout() {
    const list = $('load-workout-list');
    const emptyMsg = $('load-workout-empty');

    if (state.savedWorkouts.length === 0) {
      list.innerHTML = '';
      emptyMsg.classList.remove('hidden');
    } else {
      emptyMsg.classList.add('hidden');
      list.innerHTML = state.savedWorkouts.map(w => `
        <div class="workout-picker-item" data-id="${w.id}">
          <div>
            <div class="workout-picker-item-name">${w.name}</div>
            <div class="workout-picker-item-preview">${w.exercises.join(', ')}</div>
          </div>
        </div>
      `).join('');
    }

    showModal('modal-load-workout');
  }

  function loadWorkoutIntoDay(workoutId) {
    const workout = state.savedWorkouts.find(w => w.id === workoutId);
    if (!workout) return;

    const day = getOrCreateDayRecord(state.currentDate);
    day.workoutName = workout.name;

    // Populate exercises with last-used weights
    day.exercises = workout.exercises.map(name => {
      const last = getLastSession(name, state.currentDate);
      const sets = last ? [{ weight: last.weight, reps: last.reps }] : [];
      return {
        id: uuid(),
        exerciseName: name,
        sets: sets,
      };
    });

    save();
    hideModal('modal-load-workout');
    renderDay(state.currentDate);
  }

  // ========================================
  // Save Workout
  // ========================================
  function openSaveWorkout() {
    const day = getDayRecord(state.currentDate);
    $('save-workout-name').value = (day && day.workoutName) || '';
    showModal('modal-save-workout');
    setTimeout(() => $('save-workout-name').focus(), 100);
  }

  function confirmSaveWorkout() {
    const name = $('save-workout-name').value.trim();
    if (!name) return;

    const day = getDayRecord(state.currentDate);
    if (!day || day.exercises.length === 0) return;

    const exercises = day.exercises.map(e => e.exerciseName);

    // Update existing saved workout with same name, or create new
    const existing = state.savedWorkouts.find(w => w.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.exercises = exercises;
    } else {
      state.savedWorkouts.push({
        id: uuid(),
        name: name,
        exercises: exercises,
      });
    }

    // Also set the workout name on the day record
    day.workoutName = name;

    save();
    hideModal('modal-save-workout');
    renderDay(state.currentDate);
  }

  // ========================================
  // Render: Workouts Management
  // ========================================
  function renderWorkouts() {
    const list = $('workouts-list');
    if (state.savedWorkouts.length === 0) {
      list.innerHTML = '<p class="empty-message">No saved workouts yet.</p>';
    } else {
      list.innerHTML = state.savedWorkouts.map(w => `
        <div class="template-manage-card" data-id="${w.id}">
          <div class="template-manage-header">
            <span class="template-manage-name">${w.name}</span>
            <div class="template-manage-actions">
              <button class="btn-edit-workout" data-id="${w.id}">Edit</button>
              <button class="btn-delete-workout" data-id="${w.id}">&times;</button>
            </div>
          </div>
          <div class="template-manage-exercises">${w.exercises.join(', ')}</div>
        </div>
      `).join('');
    }
    showScreen('workouts');
  }

  // ========================================
  // Edit Saved Workout
  // ========================================
  function openEditWorkout(workout) {
    state.editingWorkout = workout;
    state.editingWorkoutExercises = workout ? [...workout.exercises] : [];
    $('edit-workout-title').textContent = workout ? 'Edit Workout' : 'New Workout';
    $('edit-workout-name').value = workout ? workout.name : '';
    renderEditWorkoutExercises();
    showModal('modal-edit-workout');
  }

  function renderEditWorkoutExercises() {
    const container = $('edit-workout-exercises');
    container.innerHTML = state.editingWorkoutExercises.map((name, idx) => `
      <div class="edit-exercise-row" data-idx="${idx}">
        <span class="edit-exercise-name">${name}</span>
        <div class="edit-exercise-actions">
          <button class="btn-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
          <button class="btn-move-down" data-idx="${idx}" ${idx === state.editingWorkoutExercises.length - 1 ? 'disabled' : ''}>&darr;</button>
          <button class="btn-remove-ex" data-idx="${idx}">&times;</button>
        </div>
      </div>
    `).join('');
  }

  function saveEditWorkout() {
    const name = $('edit-workout-name').value.trim();
    if (!name) return;
    if (state.editingWorkoutExercises.length === 0) return;

    if (state.editingWorkout) {
      state.editingWorkout.name = name;
      state.editingWorkout.exercises = [...state.editingWorkoutExercises];
    } else {
      state.savedWorkouts.push({
        id: uuid(),
        name: name,
        exercises: [...state.editingWorkoutExercises],
      });
    }
    save();
    hideModal('modal-edit-workout');
    renderWorkouts();
  }

  // ========================================
  // Add Exercise to Workout (modal)
  // ========================================
  function openWorkoutExerciseModal() {
    $('workout-exercise-search').value = '';
    renderWorkoutExerciseSuggestions('');
    showModal('modal-workout-exercise');
    setTimeout(() => $('workout-exercise-search').focus(), 100);
  }

  function renderWorkoutExerciseSuggestions(query) {
    const allNames = getAllExerciseNames();
    const q = query.toLowerCase().trim();

    const currentSet = new Set(state.editingWorkoutExercises.map(n => n.toLowerCase()));
    let filtered = allNames.filter(n => !currentSet.has(n.toLowerCase()));
    if (q) {
      filtered = filtered.filter(n => n.toLowerCase().includes(q));
    }

    const container = $('workout-exercise-suggestions');
    container.innerHTML = filtered.map(name => `
      <div class="suggestion-item" data-name="${name}">
        <span class="suggestion-name">${name}</span>
      </div>
    `).join('');
  }

  // ========================================
  // Settings
  // ========================================
  function renderSettings() {
    $('btn-theme-light').classList.toggle('active', state.settings.theme === 'light');
    $('btn-theme-dark').classList.toggle('active', state.settings.theme !== 'light');
    $('btn-unit-lb').classList.toggle('active', state.settings.weightUnit === 'lb');
    $('btn-unit-kg').classList.toggle('active', state.settings.weightUnit === 'kg');
    $('btn-devmode-on').classList.toggle('active', state.settings.devMode === true);
    $('btn-devmode-off').classList.toggle('active', state.settings.devMode !== true);
    $('dev-tools-panel').classList.toggle('hidden', !state.settings.devMode);
    showScreen('settings');
  }

  // ========================================
  // Render: Analytics
  // ========================================
  const CHART_COLORS = ['#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#a855f7', '#ec4899'];

  // ========================================
  // Exercise Library (for test data generation)
  // ========================================
  const EXERCISE_LIBRARY = [
    // Chest
    { name: 'Bench Press', category: 'chest', weightRange: { min: 95, max: 315 } },
    { name: 'Incline Bench Press', category: 'chest', weightRange: { min: 75, max: 255 } },
    { name: 'Decline Bench Press', category: 'chest', weightRange: { min: 85, max: 275 } },
    { name: 'Dumbbell Bench Press', category: 'chest', weightRange: { min: 30, max: 120 } },
    { name: 'Incline Dumbbell Press', category: 'chest', weightRange: { min: 25, max: 100 } },
    { name: 'Cable Fly', category: 'chest', weightRange: { min: 15, max: 60 } },
    { name: 'Chest Dip', category: 'chest', weightRange: { min: 0, max: 90 } },
    { name: 'Machine Chest Press', category: 'chest', weightRange: { min: 50, max: 250 } },
    // Back
    { name: 'Barbell Row', category: 'back', weightRange: { min: 95, max: 275 } },
    { name: 'Deadlift', category: 'back', weightRange: { min: 135, max: 495 } },
    { name: 'Pull-Up', category: 'back', weightRange: { min: 0, max: 90 } },
    { name: 'Lat Pulldown', category: 'back', weightRange: { min: 60, max: 220 } },
    { name: 'Seated Cable Row', category: 'back', weightRange: { min: 60, max: 200 } },
    { name: 'Dumbbell Row', category: 'back', weightRange: { min: 30, max: 120 } },
    { name: 'T-Bar Row', category: 'back', weightRange: { min: 45, max: 225 } },
    { name: 'Face Pull', category: 'back', weightRange: { min: 20, max: 70 } },
    { name: 'Rack Pull', category: 'back', weightRange: { min: 135, max: 405 } },
    // Shoulders
    { name: 'Overhead Press', category: 'shoulders', weightRange: { min: 65, max: 185 } },
    { name: 'Dumbbell Shoulder Press', category: 'shoulders', weightRange: { min: 25, max: 90 } },
    { name: 'Lateral Raise', category: 'shoulders', weightRange: { min: 10, max: 40 } },
    { name: 'Front Raise', category: 'shoulders', weightRange: { min: 10, max: 40 } },
    { name: 'Reverse Fly', category: 'shoulders', weightRange: { min: 10, max: 35 } },
    { name: 'Arnold Press', category: 'shoulders', weightRange: { min: 20, max: 70 } },
    { name: 'Upright Row', category: 'shoulders', weightRange: { min: 40, max: 120 } },
    { name: 'Machine Shoulder Press', category: 'shoulders', weightRange: { min: 40, max: 180 } },
    // Legs
    { name: 'Squat', category: 'legs', weightRange: { min: 95, max: 405 } },
    { name: 'Front Squat', category: 'legs', weightRange: { min: 75, max: 315 } },
    { name: 'Leg Press', category: 'legs', weightRange: { min: 180, max: 800 } },
    { name: 'Romanian Deadlift', category: 'legs', weightRange: { min: 95, max: 315 } },
    { name: 'Leg Curl', category: 'legs', weightRange: { min: 40, max: 160 } },
    { name: 'Leg Extension', category: 'legs', weightRange: { min: 40, max: 180 } },
    { name: 'Bulgarian Split Squat', category: 'legs', weightRange: { min: 20, max: 80 } },
    { name: 'Calf Raise', category: 'legs', weightRange: { min: 50, max: 300 } },
    { name: 'Hip Thrust', category: 'legs', weightRange: { min: 95, max: 365 } },
    { name: 'Walking Lunge', category: 'legs', weightRange: { min: 20, max: 80 } },
    // Arms
    { name: 'Barbell Curl', category: 'arms', weightRange: { min: 30, max: 120 } },
    { name: 'Dumbbell Curl', category: 'arms', weightRange: { min: 15, max: 55 } },
    { name: 'Hammer Curl', category: 'arms', weightRange: { min: 15, max: 55 } },
    { name: 'Tricep Pushdown', category: 'arms', weightRange: { min: 30, max: 100 } },
    { name: 'Skull Crusher', category: 'arms', weightRange: { min: 30, max: 100 } },
    { name: 'Overhead Tricep Extension', category: 'arms', weightRange: { min: 20, max: 80 } },
    { name: 'Preacher Curl', category: 'arms', weightRange: { min: 25, max: 90 } },
    { name: 'Cable Curl', category: 'arms', weightRange: { min: 20, max: 70 } },
    { name: 'Close-Grip Bench Press', category: 'arms', weightRange: { min: 75, max: 225 } },
    // Core
    { name: 'Plank', category: 'core', weightRange: { min: 0, max: 0 } },
    { name: 'Cable Crunch', category: 'core', weightRange: { min: 40, max: 150 } },
    { name: 'Hanging Leg Raise', category: 'core', weightRange: { min: 0, max: 25 } },
    { name: 'Ab Rollout', category: 'core', weightRange: { min: 0, max: 0 } },
    { name: 'Russian Twist', category: 'core', weightRange: { min: 10, max: 50 } },
    { name: 'Decline Sit-Up', category: 'core', weightRange: { min: 0, max: 45 } },
  ];

  const DEV_WORKOUT_TEMPLATES = [
    {
      name: 'Push Day',
      exercises: ['Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Tricep Pushdown', 'Cable Fly'],
    },
    {
      name: 'Pull Day',
      exercises: ['Deadlift', 'Barbell Row', 'Lat Pulldown', 'Face Pull', 'Barbell Curl', 'Hammer Curl'],
    },
    {
      name: 'Leg Day',
      exercises: ['Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raise'],
    },
    {
      name: 'Upper Body',
      exercises: ['Bench Press', 'Barbell Row', 'Dumbbell Shoulder Press', 'Lat Pulldown', 'Dumbbell Curl', 'Tricep Pushdown'],
    },
    {
      name: 'Lower Body',
      exercises: ['Squat', 'Hip Thrust', 'Bulgarian Split Squat', 'Leg Curl', 'Calf Raise', 'Walking Lunge'],
    },
    {
      name: 'Full Body',
      exercises: ['Squat', 'Bench Press', 'Barbell Row', 'Overhead Press', 'Romanian Deadlift', 'Pull-Up'],
    },
  ];

  // ========================================
  // Dev Mode: Test data generation
  // ========================================
  function generateTestDays(startDateStr, numDays) {
    const splits = [
      { name: 'Push', categories: ['chest', 'shoulders', 'arms'] },
      { name: 'Pull', categories: ['back', 'arms'] },
      { name: 'Legs', categories: ['legs', 'core'] },
    ];
    const isKg = state.settings.weightUnit === 'kg';
    const roundTo = isKg ? 2.5 : 5;

    function roundWeight(w) {
      return Math.round(w / roundTo) * roundTo;
    }

    function pickRandom(arr, count) {
      const shuffled = arr.slice().sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count);
    }

    const startDate = new Date(startDateStr + 'T12:00:00');
    let splitIdx = 0;

    for (let i = 0; i < numDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = toDateStr(d);

      // ~30% rest day chance
      if (Math.random() < 0.3) continue;

      const split = splits[splitIdx % splits.length];
      splitIdx++;

      // Get exercises for this split's categories
      const pool = EXERCISE_LIBRARY.filter(e => split.categories.includes(e.category));
      const chosen = pickRandom(pool, 5 + Math.floor(Math.random() * 2)); // 5-6 exercises

      // Progress factor: 0 at start, 1 at end of period
      const progress = numDays > 1 ? i / (numDays - 1) : 0.5;

      const exercises = chosen.map(ex => {
        const numSets = 3 + Math.floor(Math.random() * 2); // 3-4 sets
        const { min, max } = ex.weightRange;
        // Start at 40-60% of range, trend toward 60-85%
        const lowPct = 0.4 + progress * 0.2;
        const highPct = 0.6 + progress * 0.25;
        const basePct = lowPct + Math.random() * (highPct - lowPct);
        let baseWeight = min + (max - min) * basePct;
        if (isKg) baseWeight = baseWeight * 0.453592;
        baseWeight = roundWeight(baseWeight);
        if (baseWeight <= 0 && max > 0) baseWeight = roundTo;

        const sets = [];
        for (let s = 0; s < numSets; s++) {
          const reps = Math.max(6, Math.round(12 - s * 1.5 + (Math.random() * 2 - 1)));
          sets.push({ weight: baseWeight, reps });
        }
        return {
          id: uuid(),
          exerciseName: ex.name,
          sets,
        };
      });

      // Timer data: random 30-75 min
      const durationMs = (30 + Math.floor(Math.random() * 46)) * 60 * 1000;

      // Overwrite or create the day record
      const existing = state.days.findIndex(day => day.date === dateStr);
      const dayRecord = {
        id: existing >= 0 ? state.days[existing].id : uuid(),
        date: dateStr,
        workoutName: split.name + ' Day',
        exercises,
        timerState: 'stopped',
        timerStartedAt: null,
        timerElapsedMs: durationMs,
        timerStoppedAt: new Date(d.getTime() + durationMs).toISOString(),
      };
      if (existing >= 0) {
        state.days[existing] = dayRecord;
      } else {
        state.days.push(dayRecord);
      }
    }

    // Sort days by date
    state.days.sort((a, b) => a.date.localeCompare(b.date));
    save();
  }

  function generateSavedWorkouts() {
    let count = 0;
    DEV_WORKOUT_TEMPLATES.forEach(tpl => {
      const exists = state.savedWorkouts.some(w => w.name.toLowerCase() === tpl.name.toLowerCase());
      if (!exists) {
        state.savedWorkouts.push({
          id: uuid(),
          name: tpl.name,
          exercises: [...tpl.exercises],
        });
        count++;
      }
    });
    save();
    return count;
  }

  function resetAllData() {
    localStorage.removeItem(KEYS.days);
    localStorage.removeItem(KEYS.savedWorkouts);
    localStorage.removeItem(KEYS.settings);
    localStorage.removeItem(OLD_KEYS.workouts);
    localStorage.removeItem(OLD_KEYS.templates);
    window.location.reload();
  }

  function renderAnalytics() {
    const stats = getWorkoutStats();
    renderSummaryCards(stats);
    renderPersonalRecords(getPersonalRecords());
    renderExerciseChips();
    renderCharts();
    document.querySelectorAll('#screen-analytics .chart-unit').forEach(el => {
      el.textContent = unit();
    });
    showScreen('analytics');
  }

  function renderSummaryCards(stats) {
    $('analytics-summary').innerHTML = `
      <div class="summary-card">
        <div class="summary-value">${stats.totalDays}</div>
        <div class="summary-label">Workouts</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${stats.uniqueExercises}</div>
        <div class="summary-label">Exercises</div>
      </div>
      <div class="summary-card">
        <div class="summary-value">${stats.bestStreak}</div>
        <div class="summary-label">Best Streak</div>
      </div>
    `;
  }

  function renderPersonalRecords(records) {
    const list = $('analytics-records-list');
    if (records.length === 0) {
      list.innerHTML = '<p class="empty-message">No records yet.</p>';
      return;
    }
    list.innerHTML = '<div class="pr-list">' + records.map(r => `
      <div class="pr-row">
        <span class="pr-name">${r.name}</span>
        <span class="pr-value">${r.maxWeight} ${unit()}</span>
      </div>
    `).join('') + '</div>';
  }

  function renderExerciseChips() {
    const container = $('analytics-chips');
    container.innerHTML = state.analyticsExercises.map((name, idx) => {
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      return `<span class="exercise-chip">
        <span class="chip-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>
        ${name}
        <button class="chip-remove" data-name="${name}">&times;</button>
      </span>`;
    }).join('');
  }

  function renderCharts() {
    const svgWeight = $('svg-weight');
    const svgVolume = $('svg-volume');
    const exercises = state.analyticsExercises;

    if (exercises.length === 0) {
      svgWeight.innerHTML = '';
      svgVolume.innerHTML = '';
      $('chart-weight-empty').classList.remove('hidden');
      $('chart-volume-empty').classList.remove('hidden');
      document.querySelector('#chart-weight .chart-wrapper').classList.add('hidden');
      document.querySelector('#chart-volume .chart-wrapper').classList.add('hidden');
      return;
    }

    const allData = exercises.map((name, idx) => ({
      name,
      color: CHART_COLORS[idx % CHART_COLORS.length],
      history: getExerciseHistory(name),
    })).filter(d => d.history.length > 0);

    if (allData.length === 0) {
      svgWeight.innerHTML = '';
      svgVolume.innerHTML = '';
      $('chart-weight-empty').classList.remove('hidden');
      $('chart-volume-empty').classList.remove('hidden');
      document.querySelector('#chart-weight .chart-wrapper').classList.add('hidden');
      document.querySelector('#chart-volume .chart-wrapper').classList.add('hidden');
      return;
    }

    $('chart-weight-empty').classList.add('hidden');
    $('chart-volume-empty').classList.add('hidden');
    document.querySelector('#chart-weight .chart-wrapper').classList.remove('hidden');
    document.querySelector('#chart-volume .chart-wrapper').classList.remove('hidden');

    buildChart(svgWeight, allData, 'maxWeight');
    buildChart(svgVolume, allData, 'totalVolume');
  }

  function buildChart(svg, allData, valueKey) {
    const PAD = { left: 40, right: 10, top: 10, bottom: 30 };
    const W = 320, H = 200;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const dateSet = new Set();
    allData.forEach(d => d.history.forEach(h => dateSet.add(h.date)));
    const allDates = Array.from(dateSet).sort();

    if (allDates.length === 0) { svg.innerHTML = ''; return; }

    const minDate = new Date(allDates[0] + 'T12:00:00');
    const maxDate = new Date(allDates[allDates.length - 1] + 'T12:00:00');
    const dateRange = Math.max(1, (maxDate - minDate) / 86400000);

    let minVal = Infinity, maxVal = -Infinity;
    allData.forEach(d => d.history.forEach(h => {
      minVal = Math.min(minVal, h[valueKey]);
      maxVal = Math.max(maxVal, h[valueKey]);
    }));
    const valPad = (maxVal - minVal) * 0.1 || 10;
    minVal = Math.max(0, minVal - valPad);
    maxVal = maxVal + valPad;

    function xPos(dateStr) {
      if (allDates.length === 1) return PAD.left + plotW / 2;
      const d = new Date(dateStr + 'T12:00:00');
      return PAD.left + ((d - minDate) / 86400000 / dateRange) * plotW;
    }
    function yPos(val) {
      const range = maxVal - minVal || 1;
      return PAD.top + plotH - ((val - minVal) / range) * plotH;
    }

    // Gradient definitions for area fills
    let defs = '<defs>';
    allData.forEach((d, idx) => {
      defs += `<linearGradient id="area-${valueKey}-${idx}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${d.color}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${d.color}" stop-opacity="0"/>
      </linearGradient>`;
    });
    defs += '</defs>';

    let html = '';

    // Read theme-aware colors from CSS variables
    const cs = getComputedStyle(document.documentElement);
    const gridColor = cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.06)';
    const labelColor = cs.getPropertyValue('--text-tertiary').trim() || '#52525b';

    // Grid lines
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const val = minVal + (maxVal - minVal) * (i / gridCount);
      const y = yPos(val);
      html += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${gridColor}" stroke-width="0.5"/>`;
      html += `<text x="${PAD.left - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="${labelColor}">${Math.round(val)}</text>`;
    }

    // X-axis labels
    const maxLabels = 5;
    const step = Math.max(1, Math.ceil(allDates.length / maxLabels));
    for (let i = 0; i < allDates.length; i += step) {
      const d = new Date(allDates[i] + 'T12:00:00');
      const label = (d.getMonth() + 1) + '/' + d.getDate();
      html += `<text x="${xPos(allDates[i])}" y="${H - 8}" text-anchor="middle" font-size="8" fill="${labelColor}">${label}</text>`;
    }

    // Area fills, lines, and dots per exercise
    const baseY = PAD.top + plotH;
    allData.forEach((d, idx) => {
      const pts = d.history.map(h => ({ x: xPos(h.date), y: yPos(h[valueKey]) }));

      // Gradient area fill under line
      if (pts.length > 1) {
        const areaPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
          + ` L${pts[pts.length - 1].x},${baseY} L${pts[0].x},${baseY} Z`;
        html += `<path d="${areaPath}" fill="url(#area-${valueKey}-${idx})"/>`;
      }

      // Line
      if (pts.length > 1) {
        const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
        html += `<polyline points="${polyline}" fill="none" stroke="${d.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }

      // Dots with soft glow halo
      pts.forEach(p => {
        html += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${d.color}" opacity="0.15"/>`;
        html += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${d.color}"/>`;
      });
    });

    svg.innerHTML = defs + html;
  }

  // ========================================
  // Analytics Exercise Picker
  // ========================================
  function openAnalyticsExercisePicker() {
    $('analytics-exercise-search').value = '';
    renderAnalyticsExerciseSuggestions('');
    showModal('modal-analytics-exercise');
    setTimeout(() => $('analytics-exercise-search').focus(), 100);
  }

  function renderAnalyticsExerciseSuggestions(query) {
    const allNames = getAllExerciseNames();
    const q = query.toLowerCase().trim();
    const selectedSet = new Set(state.analyticsExercises.map(n => n.toLowerCase()));
    let filtered = allNames.filter(n => !selectedSet.has(n.toLowerCase()));
    if (q) {
      filtered = filtered.filter(n => n.toLowerCase().includes(q));
    }
    const container = $('analytics-exercise-suggestions');
    if (filtered.length === 0) {
      container.innerHTML = q
        ? '<p class="hint-text">No matching exercises.</p>'
        : '<p class="hint-text">No exercises available.</p>';
      return;
    }
    container.innerHTML = filtered.map(name => `
      <div class="suggestion-item" data-name="${name}">
        <span class="suggestion-name">${name}</span>
      </div>
    `).join('');
  }

  // ========================================
  // Event Binding
  // ========================================
  function bindEvents() {
    // --- Bottom nav ---
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const screen = btn.dataset.screen;
        if (screen === 'day') {
          state.currentDate = todayStr();
          renderDay(state.currentDate);
        } else if (screen === 'workouts') {
          renderWorkouts();
        } else if (screen === 'analytics') {
          renderAnalytics();
        } else if (screen === 'settings') {
          renderSettings();
        }
      });
    });

    // --- Day navigation ---
    $('btn-day-prev').addEventListener('click', () => {
      renderDay(prevDateStr(state.currentDate));
    });

    $('btn-day-next').addEventListener('click', () => {
      renderDay(nextDateStr(state.currentDate));
    });

    $('btn-go-today').addEventListener('click', () => {
      renderDay(todayStr());
    });

    // --- Month / Day view toggle ---
    $('btn-show-month').addEventListener('click', () => {
      showMonthView();
    });

    $('btn-show-day').addEventListener('click', () => {
      renderDay(state.currentDate);
    });

    // --- Month navigation ---
    $('btn-month-prev').addEventListener('click', () => {
      const d = new Date(state.monthViewDate + 'T12:00:00');
      d.setMonth(d.getMonth() - 1);
      state.monthViewDate = toDateStr(d);
      renderMonth();
    });

    $('btn-month-next').addEventListener('click', () => {
      const d = new Date(state.monthViewDate + 'T12:00:00');
      d.setMonth(d.getMonth() + 1);
      state.monthViewDate = toDateStr(d);
      renderMonth();
    });

    $('btn-month-today').addEventListener('click', () => {
      const today = todayStr();
      state.currentDate = today;
      state.monthViewDate = today;
      renderMonth();
    });

    // --- Month grid day click ---
    $('month-grid').addEventListener('click', (e) => {
      const dayEl = e.target.closest('.month-day');
      if (dayEl && dayEl.dataset.date) {
        state.currentDate = dayEl.dataset.date;
        renderDay(state.currentDate);
      }
    });

    // --- Day screen actions ---
    $('btn-load-workout').addEventListener('click', openLoadWorkout);
    $('btn-save-workout').addEventListener('click', openSaveWorkout);
    $('btn-add-exercise').addEventListener('click', openAddExercise);

    // --- Timer controls ---
    $('btn-timer-start').addEventListener('click', () => {
      const day = getOrCreateDayRecord(state.currentDate);
      startTimer(day);
    });

    $('btn-timer-stop').addEventListener('click', () => {
      const day = getDayRecord(state.currentDate);
      if (day) stopTimer(day);
    });

    $('btn-timer-reset').addEventListener('click', () => {
      const day = getDayRecord(state.currentDate);
      if (day) resetTimer(day);
    });

    // --- Exercise cards (delegated) ---
    $('day-exercises').addEventListener('click', (e) => {
      const day = getDayRecord(state.currentDate);
      if (!day) return;

      // Add set
      if (e.target.classList.contains('btn-add-set')) {
        const exIdx = parseInt(e.target.dataset.ex);
        const ex = day.exercises[exIdx];
        const last = getLastSession(ex.exerciseName, state.currentDate);
        const prevSet = ex.sets.length > 0 ? ex.sets[ex.sets.length - 1] : null;
        ex.sets.push({
          weight: prevSet ? prevSet.weight : (last ? last.weight : 0),
          reps: prevSet ? prevSet.reps : (last ? last.reps : 0),
        });
        save();
        renderDay(state.currentDate);
        return;
      }

      // Remove set
      if (e.target.classList.contains('set-remove')) {
        const exIdx = parseInt(e.target.dataset.ex);
        const setIdx = parseInt(e.target.dataset.set);
        day.exercises[exIdx].sets.splice(setIdx, 1);
        save();
        renderDay(state.currentDate);
        return;
      }

      // Remove exercise
      if (e.target.classList.contains('exercise-remove')) {
        const exIdx = parseInt(e.target.dataset.ex);
        day.exercises.splice(exIdx, 1);
        save();
        renderDay(state.currentDate);
        return;
      }

      // Move exercise up
      if (e.target.classList.contains('move-up')) {
        const exIdx = parseInt(e.target.dataset.ex);
        if (exIdx > 0) {
          [day.exercises[exIdx - 1], day.exercises[exIdx]] = [day.exercises[exIdx], day.exercises[exIdx - 1]];
          save();
          renderDay(state.currentDate);
        }
        return;
      }

      // Move exercise down
      if (e.target.classList.contains('move-down')) {
        const exIdx = parseInt(e.target.dataset.ex);
        if (exIdx < day.exercises.length - 1) {
          [day.exercises[exIdx], day.exercises[exIdx + 1]] = [day.exercises[exIdx + 1], day.exercises[exIdx]];
          save();
          renderDay(state.currentDate);
        }
        return;
      }
    });

    // Set input changes (delegated)
    $('day-exercises').addEventListener('input', (e) => {
      const day = getDayRecord(state.currentDate);
      if (!day) return;

      if (e.target.classList.contains('set-weight')) {
        const exIdx = parseInt(e.target.dataset.ex);
        const setIdx = parseInt(e.target.dataset.set);
        day.exercises[exIdx].sets[setIdx].weight = parseFloat(e.target.value) || 0;
        save();
      }
      if (e.target.classList.contains('set-reps')) {
        const exIdx = parseInt(e.target.dataset.ex);
        const setIdx = parseInt(e.target.dataset.set);
        day.exercises[exIdx].sets[setIdx].reps = parseInt(e.target.value) || 0;
        save();
      }
    });

    // --- Add Exercise Modal ---
    $('exercise-search').addEventListener('input', (e) => {
      renderSuggestions(e.target.value);
    });

    $('exercise-suggestions').addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (item) addExerciseToDay(item.dataset.name);
    });

    $('btn-create-exercise').addEventListener('click', createNewExercise);

    $('btn-cancel-exercise').addEventListener('click', () => {
      hideModal('modal-add-exercise');
    });

    // --- Load Workout Modal ---
    $('load-workout-list').addEventListener('click', (e) => {
      const item = e.target.closest('.workout-picker-item');
      if (item) loadWorkoutIntoDay(item.dataset.id);
    });

    $('btn-cancel-load-workout').addEventListener('click', () => {
      hideModal('modal-load-workout');
    });

    // --- Save Workout Modal ---
    $('btn-confirm-save-workout').addEventListener('click', confirmSaveWorkout);

    $('btn-cancel-save-workout').addEventListener('click', () => {
      hideModal('modal-save-workout');
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', () => {
        backdrop.closest('.modal').classList.remove('active');
      });
    });

    // --- Workouts Management ---
    $('workouts-list').addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-edit-workout')) {
        const id = e.target.dataset.id;
        const workout = state.savedWorkouts.find(w => w.id === id);
        if (workout) openEditWorkout(workout);
        return;
      }
      if (e.target.classList.contains('btn-delete-workout')) {
        const id = e.target.dataset.id;
        state.savedWorkouts = state.savedWorkouts.filter(w => w.id !== id);
        save();
        renderWorkouts();
        return;
      }
    });

    $('btn-create-workout').addEventListener('click', () => {
      openEditWorkout(null);
    });

    // --- Edit Workout Modal ---
    $('edit-workout-exercises').addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (isNaN(idx)) return;

      if (e.target.classList.contains('btn-move-up') && idx > 0) {
        const arr = state.editingWorkoutExercises;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        renderEditWorkoutExercises();
      }
      if (e.target.classList.contains('btn-move-down') && idx < state.editingWorkoutExercises.length - 1) {
        const arr = state.editingWorkoutExercises;
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        renderEditWorkoutExercises();
      }
      if (e.target.classList.contains('btn-remove-ex')) {
        state.editingWorkoutExercises.splice(idx, 1);
        renderEditWorkoutExercises();
      }
    });

    $('btn-edit-workout-add').addEventListener('click', openWorkoutExerciseModal);

    $('btn-edit-workout-save').addEventListener('click', saveEditWorkout);

    $('btn-edit-workout-cancel').addEventListener('click', () => {
      hideModal('modal-edit-workout');
    });

    // --- Add Exercise to Workout Modal ---
    $('workout-exercise-search').addEventListener('input', (e) => {
      renderWorkoutExerciseSuggestions(e.target.value);
    });

    $('workout-exercise-suggestions').addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (item) {
        state.editingWorkoutExercises.push(item.dataset.name);
        hideModal('modal-workout-exercise');
        renderEditWorkoutExercises();
      }
    });

    $('btn-workout-exercise-create').addEventListener('click', () => {
      const name = $('workout-exercise-search').value.trim();
      if (!name) return;
      state.editingWorkoutExercises.push(name);
      hideModal('modal-workout-exercise');
      renderEditWorkoutExercises();
    });

    $('btn-workout-exercise-cancel').addEventListener('click', () => {
      hideModal('modal-workout-exercise');
    });

    // --- Analytics ---
    $('btn-add-analytics-exercise').addEventListener('click', openAnalyticsExercisePicker);

    $('analytics-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-remove');
      if (btn) {
        state.analyticsExercises = state.analyticsExercises.filter(n => n !== btn.dataset.name);
        renderExerciseChips();
        renderCharts();
      }
    });

    $('analytics-exercise-search').addEventListener('input', (e) => {
      renderAnalyticsExerciseSuggestions(e.target.value);
    });

    $('analytics-exercise-suggestions').addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (item) {
        state.analyticsExercises.push(item.dataset.name);
        hideModal('modal-analytics-exercise');
        renderExerciseChips();
        renderCharts();
      }
    });

    $('btn-cancel-analytics-exercise').addEventListener('click', () => {
      hideModal('modal-analytics-exercise');
    });

    // --- Settings ---
    $('btn-theme-light').addEventListener('click', () => {
      state.settings.theme = 'light';
      save();
      applyTheme();
      renderSettings();
    });

    $('btn-theme-dark').addEventListener('click', () => {
      state.settings.theme = 'dark';
      save();
      applyTheme();
      renderSettings();
    });

    $('btn-unit-lb').addEventListener('click', () => {
      state.settings.weightUnit = 'lb';
      save();
      renderSettings();
    });

    $('btn-unit-kg').addEventListener('click', () => {
      state.settings.weightUnit = 'kg';
      save();
      renderSettings();
    });

    // --- Dev Mode ---
    $('btn-devmode-on').addEventListener('click', () => {
      state.settings.devMode = true;
      save();
      renderSettings();
    });

    $('btn-devmode-off').addEventListener('click', () => {
      state.settings.devMode = false;
      save();
      renderSettings();
    });

    $('btn-dev-generate-days').addEventListener('click', () => {
      const numDays = 14;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - numDays);
      $('input-gen-days-count').value = numDays;
      $('input-gen-days-start').value = toDateStr(startDate);
      showModal('modal-generate-days');
    });

    $('btn-confirm-generate-days').addEventListener('click', () => {
      const count = parseInt($('input-gen-days-count').value) || 14;
      const startDate = $('input-gen-days-start').value;
      if (!startDate) return;
      generateTestDays(startDate, Math.min(90, Math.max(1, count)));
      hideModal('modal-generate-days');
      renderDay(state.currentDate);
    });

    $('btn-cancel-generate-days').addEventListener('click', () => {
      hideModal('modal-generate-days');
    });

    $('btn-dev-generate-workouts').addEventListener('click', () => {
      const count = generateSavedWorkouts();
      $('btn-dev-generate-workouts').textContent = count > 0
        ? `Added ${count} workout${count > 1 ? 's' : ''}!`
        : 'Already up to date!';
      setTimeout(() => {
        $('btn-dev-generate-workouts').textContent = 'Generate Saved Workouts';
      }, 1500);
    });

    $('btn-dev-reset').addEventListener('click', () => {
      showModal('modal-confirm-reset');
    });

    $('btn-confirm-reset').addEventListener('click', () => {
      resetAllData();
    });

    $('btn-cancel-reset').addEventListener('click', () => {
      hideModal('modal-confirm-reset');
    });

    // --- Exercise Library ---
    $('btn-browse-library').addEventListener('click', () => {
      state.libraryFilters = {};
      state.librarySearch = '';
      $('library-search').value = '';
      renderLibrary();
    });

    $('btn-library-back').addEventListener('click', () => {
      renderSettings();
    });

    $('library-search').addEventListener('input', (e) => {
      state.librarySearch = e.target.value;
      renderLibraryList();
    });

    // Filter chips (delegated)
    $('library-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      const category = chip.dataset.category;
      const value = chip.dataset.value;

      if (category === 'calisthenics') {
        state.libraryFilters.calisthenics = state.libraryFilters.calisthenics === true ? null : true;
      } else {
        state.libraryFilters[category] = state.libraryFilters[category] === value ? null : value;
      }
      renderLibraryFilters();
      renderLibraryList();
    });

    // Library list item click
    $('library-list').addEventListener('click', (e) => {
      const item = e.target.closest('.library-item');
      if (item) renderExerciseDetail(item.dataset.name);
    });

    // Exercise detail
    $('btn-detail-back').addEventListener('click', () => {
      renderLibrary();
    });

    $('detail-alternatives-list').addEventListener('click', (e) => {
      const item = e.target.closest('.detail-alt-item');
      if (item && !item.classList.contains('no-link')) {
        renderExerciseDetail(item.dataset.name);
      }
    });

    // Import / Export library
    $('btn-import-library').addEventListener('click', () => {
      $('library-file-input').click();
    });

    $('library-file-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        importLibrary(e.target.files[0]);
        e.target.value = '';
      }
    });

    $('btn-export-library').addEventListener('click', exportLibrary);
  }

  // ========================================
  // Init
  // ========================================
  function init() {
    load();
    applyTheme();
    bindEvents();
    state.currentDate = todayStr();

    // Load exercise library (from localStorage or default file)
    if (!loadLibrary()) {
      loadDefaultLibrary().then(() => {
        // Re-render if on day screen to pick up library exercise names
        if (state.viewMode === 'day') renderDay(state.currentDate);
      });
    }

    renderDay(state.currentDate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
