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
    settings: { weightUnit: 'lb' },
    currentDate: null,   // YYYY-MM-DD string for the day screen
    timerInterval: null,
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

    document.querySelectorAll('.nav-item').forEach(btn => {
      const target = btn.dataset.screen;
      btn.classList.toggle('active', target === name || (target === 'day' && name === 'day'));
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
      return `
        <div class="suggestion-item" data-name="${name}">
          <span class="suggestion-name">${name}</span>
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
    $('btn-unit-lb').classList.toggle('active', state.settings.weightUnit === 'lb');
    $('btn-unit-kg').classList.toggle('active', state.settings.weightUnit === 'kg');
    showScreen('settings');
  }

  // ========================================
  // Render: Analytics
  // ========================================
  const CHART_COLORS = ['#007aff', '#ff9500', '#34c759', '#ff3b30', '#af52de', '#5ac8fa'];

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
        <span class="chip-dot" style="background:${color}"></span>
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

    let html = '';

    // Grid lines
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const val = minVal + (maxVal - minVal) * (i / gridCount);
      const y = yPos(val);
      html += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#e5e5ea" stroke-width="0.5"/>`;
      html += `<text x="${PAD.left - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="#6e6e73">${Math.round(val)}</text>`;
    }

    // X-axis labels
    const maxLabels = 5;
    const step = Math.max(1, Math.ceil(allDates.length / maxLabels));
    for (let i = 0; i < allDates.length; i += step) {
      const d = new Date(allDates[i] + 'T12:00:00');
      const label = (d.getMonth() + 1) + '/' + d.getDate();
      html += `<text x="${xPos(allDates[i])}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#6e6e73">${label}</text>`;
    }

    // Lines and dots per exercise
    allData.forEach(d => {
      const pts = d.history.map(h => ({ x: xPos(h.date), y: yPos(h[valueKey]) }));
      if (pts.length > 1) {
        const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
        html += `<polyline points="${polyline}" fill="none" stroke="${d.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      pts.forEach(p => {
        html += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${d.color}"/>`;
      });
    });

    svg.innerHTML = html;
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
  }

  // ========================================
  // Init
  // ========================================
  function init() {
    load();
    bindEvents();
    state.currentDate = todayStr();
    renderDay(state.currentDate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
