//! Global hotkey service (SPEC FR-1): bare-modifier bindings via handy-keys.
//! The HotkeyManager is !Sync, so it lives on a dedicated thread; commands
//! arrive over a channel (pattern adapted from Handy, MIT).
//!
//! Two logical bindings exist: "main" (the dictation hotkey, always registered
//! once capture is initialized) and "cancel" (Escape, registered only while
//! recording so it isn't globally swallowed when idle).

use anyhow::{anyhow, Result};
use handy_keys::{Hotkey, HotkeyId, HotkeyManager, HotkeyState, KeyboardListener};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use tauri::{AppHandle, Emitter};

pub enum Command {
    SetMainBinding {
        binding: String,
        reply: mpsc::Sender<Result<()>>,
    },
    SetCancelRegistered(bool),
    Shutdown,
}

#[derive(Clone)]
pub struct HotkeyService {
    tx: mpsc::Sender<Command>,
    capture_active: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
pub struct CaptureEvent {
    pub hotkey_string: String,
    pub is_key_down: bool,
}

/// Validate a binding string without registering it.
pub fn validate_binding(binding: &str) -> Result<()> {
    binding
        .parse::<Hotkey>()
        .map(|_| ())
        .map_err(|e| anyhow!("invalid hotkey '{binding}': {e}"))
}

impl HotkeyService {
    /// Start the manager thread and register the main binding. Fails if the
    /// event tap can't start (macOS: Accessibility not granted).
    pub fn start(app: AppHandle, main_binding: String) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<Command>();
        let (init_tx, init_rx) = mpsc::channel::<Result<()>>();
        std::thread::Builder::new()
            .name("hotkey-manager".into())
            .spawn(move || manager_thread(app, main_binding, rx, init_tx))
            .expect("spawn hotkey thread");
        init_rx
            .recv()
            .map_err(|_| anyhow!("hotkey thread died during init"))??;
        Ok(Self {
            tx,
            capture_active: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn set_main_binding(&self, binding: String) -> Result<()> {
        validate_binding(&binding)?;
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Command::SetMainBinding { binding, reply })
            .map_err(|_| anyhow!("hotkey thread gone"))?;
        rx.recv().map_err(|_| anyhow!("hotkey thread gone"))?
    }

    pub fn set_cancel_registered(&self, registered: bool) {
        let _ = self.tx.send(Command::SetCancelRegistered(registered));
    }

    /// Capture the next key combo for the settings recorder UI. Events are
    /// emitted to the frontend as "hotkey-capture-event"; capture stops when
    /// `stop_capture` is called or the window closes.
    pub fn start_capture(&self, app: AppHandle) {
        if self.capture_active.swap(true, Ordering::SeqCst) {
            return; // already capturing
        }
        let active = self.capture_active.clone();
        std::thread::Builder::new()
            .name("hotkey-capture".into())
            .spawn(move || {
                let listener = match KeyboardListener::new() {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("hotkey capture listener failed: {e}");
                        active.store(false, Ordering::SeqCst);
                        return;
                    }
                };
                while active.load(Ordering::SeqCst) {
                    while let Some(event) = listener.try_recv() {
                        let hotkey_string = event
                            .as_hotkey()
                            .map(|h| h.to_handy_string())
                            .unwrap_or_default();
                        let _ = app.emit(
                            "hotkey-capture-event",
                            CaptureEvent {
                                hotkey_string,
                                is_key_down: event.is_key_down,
                            },
                        );
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            })
            .expect("spawn capture thread");
    }

    pub fn stop_capture(&self) {
        self.capture_active.store(false, Ordering::SeqCst);
    }
}

impl Drop for HotkeyService {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Shutdown);
    }
}

fn manager_thread(
    app: AppHandle,
    main_binding: String,
    rx: mpsc::Receiver<Command>,
    init_tx: mpsc::Sender<Result<()>>,
) {
    let mut manager = match HotkeyManager::new_with_blocking() {
        Ok(m) => m,
        Err(e) => {
            let _ = init_tx.send(Err(anyhow!("starting keyboard listener: {e}")));
            return;
        }
    };

    let mut main_id: Option<HotkeyId> = match register(&mut manager, &main_binding) {
        Ok(id) => {
            let _ = init_tx.send(Ok(()));
            Some(id)
        }
        Err(e) => {
            let _ = init_tx.send(Err(e));
            return;
        }
    };
    let mut cancel_id: Option<HotkeyId> = None;

    loop {
        while let Some(event) = manager.try_recv() {
            let pressed = event.state == HotkeyState::Pressed;
            if Some(event.id) == main_id {
                let state = app.state::<crate::state::AppState>();
                state.pipeline.hotkey(pressed);
            } else if Some(event.id) == cancel_id && pressed {
                let state = app.state::<crate::state::AppState>();
                state.pipeline.cancel();
            }
        }
        match rx.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(Command::SetMainBinding { binding, reply }) => {
                if let Some(id) = main_id.take() {
                    let _ = manager.unregister(id);
                }
                let result = register(&mut manager, &binding);
                match result {
                    Ok(id) => {
                        main_id = Some(id);
                        let _ = reply.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(e));
                    }
                }
            }
            Ok(Command::SetCancelRegistered(true)) => {
                if cancel_id.is_none() {
                    cancel_id = register(&mut manager, "escape").ok();
                }
            }
            Ok(Command::SetCancelRegistered(false)) => {
                if let Some(id) = cancel_id.take() {
                    let _ = manager.unregister(id);
                }
            }
            Ok(Command::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn register(manager: &mut HotkeyManager, binding: &str) -> Result<HotkeyId> {
    let hotkey: Hotkey = binding
        .parse()
        .map_err(|e| anyhow!("invalid hotkey '{binding}': {e}"))?;
    manager
        .register(hotkey)
        .map_err(|e| anyhow!("registering '{binding}': {e}"))
}

use tauri::Manager;
