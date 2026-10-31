use std::env;
use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

#[cfg(not(debug_assertions))]
use std::{
    ffi::OsString,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const BACKEND_PORT: u16 = 17300;

struct Backend(Mutex<Option<Child>>);

#[cfg(not(debug_assertions))]
fn wait_port(port: u16, timeout: Duration) -> Result<(), String> {
    let addr = format!("127.0.0.1:{port}");
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(&addr).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(120));
    }
    Err(format!("Next.js tidak muncul di {addr}"))
}

#[cfg(not(debug_assertions))]
fn join_search_path(dir: &Path, rest: Option<OsString>) -> OsString {
    let mut out = dir.as_os_str().to_os_string();
    if let Some(r) = rest {
        out.push(if cfg!(windows) { ";" } else { ":" });
        out.push(r);
    }
    out
}

#[cfg(not(debug_assertions))]
fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let nested = dir.join("resources");
    if nested.join("server").join("server.js").exists() {
        Ok(nested)
    } else {
        Ok(dir)
    }
}

fn fill_main_window(win: &tauri::WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    #[cfg(not(target_os = "linux"))]
    {
        let _ = win.set_decorations(true);
    }
    let _ = win.maximize();
    let _ = win.set_focus();
}

fn fix_webview_env() {
    #[cfg(target_os = "linux")]
    {
        // linuxdeploy AppRun sets GST_* to empty AppDir plugin dirs.
        // WebKit then fails to find appsink and WebKitWebProcess dies (black window).
        for key in ["GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_PATH"] {
            env::remove_var(key);
        }
        let sys = std::path::Path::new("/usr/lib/gstreamer-1.0");
        if sys.is_dir() {
            env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", sys);
        }
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

#[cfg(not(debug_assertions))]
fn spawn_backend(app: &tauri::AppHandle) -> Result<Option<Child>, String> {
    if TcpStream::connect(format!("127.0.0.1:{BACKEND_PORT}")).is_ok() {
        return Ok(None);
    }
    let resources = resource_root(app)?;
    let server = resources.join("server");
    let server_js = server.join("server.js");
    if !server_js.exists() {
        return Err(format!(
            "server.js tidak ada di {} — jalankan pnpm tauri:build",
            server.display()
        ));
    }
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data.join("models")).map_err(|e| e.to_string())?;

    let bin = resources.join("bin");
    let node = {
        let bundled = bin.join(if cfg!(windows) { "node.exe" } else { "node" });
        if bundled.exists() {
            bundled
        } else {
            PathBuf::from("node")
        }
    };

    let mut cmd = Command::new(&node);
    cmd.current_dir(&server)
        .arg("server.js")
        .env("PORT", BACKEND_PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("SOROTIN_TAURI", "1")
        .env("SOROTIN_LICENSE_REQUIRED", "1")
        .env("PERSONAL_CLIPPER_DATA_DIR", &data)
        .env("HF_HOME", data.join("models"))
        .env("XDG_CACHE_HOME", data.join("cache"))
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    if bin.exists() {
        cmd.env("PATH", join_search_path(&bin, env::var_os("PATH")));
    }

    let python = if cfg!(windows) {
        resources.join("python/python.exe")
    } else {
        resources.join("python/bin/python3")
    };
    if python.exists() {
        let py_home = resources.join("python");
        cmd.env("PERSONAL_CLIPPER_PYTHON", &python);
        // linuxdeploy AppRun sets PYTHONHOME=$APPDIR/usr, which hides encodings.
        cmd.env("PYTHONHOME", &py_home);
        cmd.env("PYTHONNOUSERSITE", "1");
        let py_lib = py_home.join("lib");
        if py_lib.exists() && cfg!(not(windows)) {
            cmd.env(
                "LD_LIBRARY_PATH",
                join_search_path(&py_lib, env::var_os("LD_LIBRARY_PATH")),
            );
        }
    }

    let fonts = resources.join("fonts");
    if fonts.exists() {
        cmd.env("PERSONAL_CLIPPER_FONT_DIR", &fonts);
        let cover = fonts.join("NotoSans-Black.ttf");
        if cover.exists() {
            cmd.env("PERSONAL_CLIPPER_COVER_FONT", cover);
        }
    }

    let scripts = resources.join("scripts");
    if scripts.exists() {
        cmd.env("PERSONAL_CLIPPER_SCRIPTS_DIR", scripts);
    }

    cmd.spawn()
        .map(Some)
        .map_err(|e| {
            format!(
                "gagal menjalankan {} ({e}). Bundle Node/ffmpeg belum lengkap.",
                node.display()
            )
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_webview_env();
    tauri::Builder::default()
        .setup(|app| {
            app.manage(Backend(Mutex::new(None)));
            #[cfg(not(debug_assertions))]
            {
                let child = spawn_backend(app.handle())?;
                *app.state::<Backend>().0.lock().expect("backend") = child;
                wait_port(BACKEND_PORT, Duration::from_secs(40))?;
                if let Some(win) = app.get_webview_window("main") {
                    fill_main_window(&win);
                    let _ = win.eval(&format!(
                        "window.location.replace('http://127.0.0.1:{BACKEND_PORT}/')"
                    ));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tauri")
        .run(|app, event| {
            match event {
                RunEvent::Ready => {
                    if let Some(win) = app.get_webview_window("main") {
                        fill_main_window(&win);
                    }
                }
                RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                    if let Some(state) = app.try_state::<Backend>() {
                        if let Some(mut child) = state.0.lock().expect("backend").take() {
                            let _ = child.kill();
                        }
                    }
                }
                _ => {}
            }
        });
}
