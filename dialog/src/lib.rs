//! Experimental: Slate as the Windows Open / Save dialog.
//!
//! When the user turns this on in Slate's settings, Slate registers this DLL
//! (per user, under HKCU) as the provider of the system file dialogs. Every
//! app that asks Windows for an Open or Save dialog then gets this object.
//!
//! Safety design: the real Windows dialog is always created inside this one,
//! and every call is forwarded to it. Slate is only used for `Show` when the
//! request is something Slate can do faithfully. In every other case, and on
//! any failure (Slate missing, crashed, pipe error, panic), the real dialog
//! is shown instead, so apps keep working.
//!
//! Falls back to the real dialog when:
//!  * the app adds its own controls (IFileDialogCustomize), a filter callback
//!    or a navigation root
//!  * Shift is held when the dialog opens
//!  * the host process is Slate itself
//!  * Slate can't be reached within a few seconds
#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::ffi::c_void;
use std::io::{BufRead, BufReader, Write};
use std::os::windows::io::FromRawHandle;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{Duration, Instant};

use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::Storage::FileSystem::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::LibraryLoader::*;
use windows::Win32::System::Ole::*;
use windows::Win32::System::Pipes::*;
use windows::Win32::System::Registry::*;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::Shell::Common::*;
use windows::Win32::UI::Shell::PropertiesSystem::*;
use windows::Win32::UI::Shell::*;
use windows::Win32::UI::WindowsAndMessaging::*;

const CLSID_OPEN: GUID = GUID::from_u128(0xDC1C5A9C_E88A_4dde_A5A1_60F82A20AEF7);
const CLSID_SAVE: GUID = GUID::from_u128(0xC0B4E2F3_BA21_4773_8DBA_335EC946EB8B);

/* ---------- the real dialog, straight from comdlg32 ---------- */

type GetClassObjectFn = unsafe extern "system" fn(*const GUID, *const GUID, *mut *mut c_void) -> HRESULT;

fn real_dialog(clsid: &GUID) -> Result<IFileDialog> {
    unsafe {
        let m = LoadLibraryExW(w!("comdlg32.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32)?;
        let p = GetProcAddress(m, s!("DllGetClassObject")).ok_or_else(|| Error::from(E_FAIL))?;
        let get: GetClassObjectFn = std::mem::transmute(p);
        let mut out = std::ptr::null_mut();
        get(clsid, &IClassFactory::IID, &mut out).ok()?;
        let f = IClassFactory::from_raw(out);
        f.CreateInstance::<Option<&IUnknown>, IFileDialog>(None)
    }
}

/* ---------- helpers ---------- */

fn path_of(i: &IShellItem) -> Option<String> {
    unsafe {
        let p = i.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s
    }
}

fn item(path: &str) -> Result<IShellItem> {
    let w = HSTRING::from(path);
    unsafe {
        if let Ok(i) = SHCreateItemFromParsingName::<_, _, IShellItem>(&w, None) {
            return Ok(i);
        }
        // a file that doesn't exist yet (Save): build a simple ID list instead
        let pidl = SHSimpleIDListFromPath(&w);
        if pidl.is_null() {
            return Err(E_FAIL.into());
        }
        let r = SHCreateItemFromIDList::<IShellItem>(pidl);
        ILFree(Some(pidl));
        r
    }
}

fn items(paths: &[String]) -> Result<IShellItemArray> {
    unsafe {
        let mut pidls = Vec::new();
        for p in paths {
            let w = HSTRING::from(p.as_str());
            let mut pidl = ILCreateFromPathW(&w);
            if pidl.is_null() {
                pidl = SHSimpleIDListFromPath(&w);
            }
            if !pidl.is_null() {
                pidls.push(pidl as *const ITEMIDLIST);
            }
        }
        let r = SHCreateShellItemArrayFromIDLists(&pidls);
        for p in pidls {
            ILFree(Some(p));
        }
        r
    }
}

fn co_string(s: &str) -> Result<PWSTR> {
    let w: Vec<u16> = s.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let p = CoTaskMemAlloc(w.len() * 2) as *mut u16;
        if p.is_null() {
            return Err(E_OUTOFMEMORY.into());
        }
        std::ptr::copy_nonoverlapping(w.as_ptr(), p, w.len());
        Ok(PWSTR(p))
    }
}

fn pcwstr(p: &PCWSTR) -> Option<String> {
    if p.is_null() {
        None
    } else {
        unsafe { p.to_string().ok() }
    }
}

fn host_exe() -> String {
    let mut buf = [0u16; 520];
    let n = unsafe { GetModuleFileNameW(None, &mut buf) } as usize;
    String::from_utf16_lossy(&buf[..n])
}

fn picker_host() -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut len = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, w!("Software\\Slate"), w!("PickerHost"), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as _), Some(&mut len))
    };
    if r.is_err() {
        return None;
    }
    let n = (len as usize / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..n]))
}

fn pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
    format!(r"\\.\pipe\slate-picker-{}", user.replace(['\\', '/', ' '], "_"))
}

/// Pump this thread's messages for a short while, so the app keeps painting.
fn pump(ms: u32) -> bool {
    unsafe {
        MsgWaitForMultipleObjects(None, false, ms, QS_ALLINPUT);
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            if msg.message == WM_QUIT {
                PostQuitMessage(msg.wParam.0 as i32);
                return false;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    true
}

fn connect() -> Option<HANDLE> {
    let name = HSTRING::from(pipe_name());
    let open = || unsafe { CreateFileW(&name, (GENERIC_READ | GENERIC_WRITE).0, FILE_SHARE_NONE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None).ok() };
    if let Some(h) = open() {
        return Some(h);
    }
    // Slate isn't running: start it in the background and wait for it.
    let exe = picker_host()?;
    if !std::path::Path::new(&exe).exists() {
        return None;
    }
    std::process::Command::new(&exe).arg("--picker-host").spawn().ok()?;
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(10) {
        if let Some(h) = open() {
            return Some(h);
        }
        if !pump(100) {
            return None;
        }
    }
    None
}

/* ---------- the wire format (one JSON line each way) ---------- */

#[derive(Serialize)]
struct Filter {
    name: String,
    spec: String,
}

#[derive(Serialize)]
struct Request {
    mode: &'static str, // "open" | "save" | "folder"
    multi: bool,
    title: Option<String>,
    ok_label: Option<String>,
    folder: Option<String>,
    file_name: Option<String>,
    filters: Vec<Filter>,
    type_index: u32,
    default_ext: Option<String>,
    overwrite_prompt: bool,
    must_exist: bool,
    app: String,
    owner: Option<[i32; 4]>,
}

#[derive(Deserialize)]
struct Response {
    ok: bool,
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    type_index: Option<u32>,
}

/* ---------- shared state ---------- */

#[derive(Default)]
struct State {
    filters: Vec<(String, String)>,
    type_index: u32,
    options: FILEOPENDIALOGOPTIONS,
    folder: Option<String>,
    default_folder: Option<String>,
    file_name: Option<String>,
    title: Option<String>,
    ok_label: Option<String>,
    default_ext: Option<String>,
    /// the app relies on something only the real dialog can do
    custom: bool,
    events: Vec<(u32, IFileDialogEvents)>,
    /// paths Slate returned; once set, getters answer from these
    result: Option<Vec<String>>,
}

struct Core {
    inner: IFileDialog,
    save: bool,
    st: RefCell<State>,
}

impl Core {
    fn new(inner: IFileDialog, save: bool) -> Self {
        let options = unsafe { inner.GetOptions() }.unwrap_or_default();
        Core { inner, save, st: RefCell::new(State { type_index: 1, options, ..Default::default() }) }
    }

    fn mark_custom(&self) {
        self.st.borrow_mut().custom = true;
    }

    fn result(&self) -> Option<Vec<String>> {
        self.st.borrow().result.clone()
    }

    /// Ask Slate to pick. None means "use the real dialog instead".
    fn try_slate(&self, owner: HWND, me: &IFileDialog) -> Option<Result<()>> {
        if self.st.borrow().custom {
            return None;
        }
        if unsafe { GetKeyState(VK_SHIFT.0 as i32) } < 0 {
            return None;
        }
        let exe = host_exe();
        let app = std::path::Path::new(&exe).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if app.eq_ignore_ascii_case("slate") {
            return None;
        }
        let req = {
            let st = self.st.borrow();
            let o = st.options;
            if (o & FOS_ALLNONSTORAGEITEMS).0 != 0 {
                return None;
            }
            let rect = if owner.is_invalid() {
                None
            } else {
                let mut r = RECT::default();
                let root = unsafe { GetAncestor(owner, GA_ROOT) };
                unsafe { GetWindowRect(root, &mut r) }.ok().map(|_| [r.left, r.top, r.right, r.bottom])
            };
            Request {
                mode: if (o & FOS_PICKFOLDERS).0 != 0 { "folder" } else if self.save { "save" } else { "open" },
                multi: (o & FOS_ALLOWMULTISELECT).0 != 0,
                title: st.title.clone(),
                ok_label: st.ok_label.clone(),
                folder: st.folder.clone().or_else(|| st.default_folder.clone()),
                file_name: st.file_name.clone(),
                filters: st.filters.iter().map(|(n, s)| Filter { name: n.clone(), spec: s.clone() }).collect(),
                type_index: st.type_index,
                default_ext: st.default_ext.clone(),
                overwrite_prompt: (o & FOS_OVERWRITEPROMPT).0 != 0,
                must_exist: (o & FOS_FILEMUSTEXIST).0 != 0,
                app,
                owner: rect,
            }
        };
        let line = serde_json::to_string(&req).ok()?;

        let h = connect()?;
        let mut pid = 0u32;
        if unsafe { GetNamedPipeServerProcessId(h, &mut pid) }.is_ok() {
            let _ = unsafe { AllowSetForegroundWindow(pid) };
        }
        let file = unsafe { std::fs::File::from_raw_handle(h.0) };
        let (tx, rx) = std::sync::mpsc::channel::<Option<Response>>();
        std::thread::spawn(move || {
            let mut f = file;
            let r = (|| {
                f.write_all(line.as_bytes()).ok()?;
                f.write_all(b"\n").ok()?;
                f.flush().ok()?;
                let mut s = String::new();
                BufReader::new(&f).read_line(&mut s).ok()?;
                serde_json::from_str::<Response>(s.trim()).ok()
            })();
            let _ = tx.send(r);
        });

        // behave like a modal dialog: the app stays painted but can't be used
        let had_owner = !owner.is_invalid();
        if had_owner {
            let _ = unsafe { EnableWindow(owner, false) };
        }
        let resp = loop {
            match rx.try_recv() {
                Ok(r) => break r,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break None,
                Err(_) => {
                    if !pump(50) {
                        break None;
                    }
                }
            }
        };
        if had_owner {
            unsafe {
                let _ = EnableWindow(owner, true);
                let _ = SetForegroundWindow(owner);
            }
        }

        let resp = resp?; // Slate went away mid-pick: show the real dialog
        if !resp.ok || resp.paths.is_empty() {
            return Some(Err(HRESULT::from_win32(ERROR_CANCELLED.0).into()));
        }
        {
            let mut st = self.st.borrow_mut();
            st.result = Some(resp.paths);
            if let Some(t) = resp.type_index {
                st.type_index = t;
            }
        }
        // let the app validate the choice, as the real dialog would
        let events: Vec<IFileDialogEvents> = self.st.borrow().events.iter().map(|(_, e)| e.clone()).collect();
        for ev in events {
            let hr = unsafe { (Interface::vtable(&ev).OnFileOk)(Interface::as_raw(&ev), Interface::as_raw(me)) };
            if hr != S_OK {
                self.st.borrow_mut().result = None;
                return None;
            }
        }
        Some(Ok(()))
    }
}

/* ---------- the two dialog objects ---------- */

#[implement(IFileOpenDialog, IFileDialog2, IFileDialogCustomize, IObjectWithSite)]
struct OpenDialog {
    core: Core,
}

#[implement(IFileSaveDialog, IFileDialog2, IFileDialogCustomize, IObjectWithSite)]
struct SaveDialog {
    core: Core,
}

macro_rules! common {
    ($t:ident) => {
        impl IModalWindow_Impl for $t {
            fn Show(&self, owner: HWND) -> Result<()> {
                let me: IFileDialog = self.to_interface::<IFileDialog2>().cast()?;
                match catch_unwind(AssertUnwindSafe(|| self.core.try_slate(owner, &me))) {
                    Ok(Some(r)) => r,
                    _ => unsafe { self.core.inner.Show(Some(owner)) },
                }
            }
        }

        impl IFileDialog_Impl for $t {
            fn SetFileTypes(&self, n: u32, spec: *const COMDLG_FILTERSPEC) -> Result<()> {
                if n > 0 && !spec.is_null() {
                    let s = unsafe { std::slice::from_raw_parts(spec, n as usize) };
                    self.core.st.borrow_mut().filters = s.iter().map(|f| (pcwstr(&f.pszName).unwrap_or_default(), pcwstr(&f.pszSpec).unwrap_or_default())).collect();
                    unsafe { self.core.inner.SetFileTypes(s) }
                } else {
                    unsafe { self.core.inner.SetFileTypes(&[]) }
                }
            }
            fn SetFileTypeIndex(&self, i: u32) -> Result<()> {
                self.core.st.borrow_mut().type_index = i;
                unsafe { self.core.inner.SetFileTypeIndex(i) }
            }
            fn GetFileTypeIndex(&self) -> Result<u32> {
                if self.core.result().is_some() {
                    return Ok(self.core.st.borrow().type_index);
                }
                unsafe { self.core.inner.GetFileTypeIndex() }
            }
            fn Advise(&self, ev: Ref<IFileDialogEvents>) -> Result<u32> {
                let e = ev.ok()?;
                let cookie = unsafe { self.core.inner.Advise(e)? };
                self.core.st.borrow_mut().events.push((cookie, e.clone()));
                Ok(cookie)
            }
            fn Unadvise(&self, cookie: u32) -> Result<()> {
                self.core.st.borrow_mut().events.retain(|(c, _)| *c != cookie);
                unsafe { self.core.inner.Unadvise(cookie) }
            }
            fn SetOptions(&self, fos: FILEOPENDIALOGOPTIONS) -> Result<()> {
                self.core.st.borrow_mut().options = fos;
                unsafe { self.core.inner.SetOptions(fos) }
            }
            fn GetOptions(&self) -> Result<FILEOPENDIALOGOPTIONS> {
                unsafe { self.core.inner.GetOptions() }
            }
            fn SetDefaultFolder(&self, psi: Ref<IShellItem>) -> Result<()> {
                let i = psi.ok()?;
                self.core.st.borrow_mut().default_folder = path_of(i);
                unsafe { self.core.inner.SetDefaultFolder(i) }
            }
            fn SetFolder(&self, psi: Ref<IShellItem>) -> Result<()> {
                let i = psi.ok()?;
                self.core.st.borrow_mut().folder = path_of(i);
                unsafe { self.core.inner.SetFolder(i) }
            }
            fn GetFolder(&self) -> Result<IShellItem> {
                if let Some(r) = self.core.result() {
                    let p = std::path::Path::new(&r[0]);
                    let dir = if self.core.st.borrow().options.0 & FOS_PICKFOLDERS.0 != 0 { p } else { p.parent().unwrap_or(p) };
                    return item(&dir.to_string_lossy());
                }
                unsafe { self.core.inner.GetFolder() }
            }
            fn GetCurrentSelection(&self) -> Result<IShellItem> {
                if let Some(r) = self.core.result() {
                    return item(&r[0]);
                }
                unsafe { self.core.inner.GetCurrentSelection() }
            }
            fn SetFileName(&self, name: &PCWSTR) -> Result<()> {
                self.core.st.borrow_mut().file_name = pcwstr(name);
                unsafe { self.core.inner.SetFileName(*name) }
            }
            fn GetFileName(&self) -> Result<PWSTR> {
                if let Some(r) = self.core.result() {
                    let n = std::path::Path::new(&r[0]).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    return co_string(&n);
                }
                unsafe { self.core.inner.GetFileName() }
            }
            fn SetTitle(&self, t: &PCWSTR) -> Result<()> {
                self.core.st.borrow_mut().title = pcwstr(t);
                unsafe { self.core.inner.SetTitle(*t) }
            }
            fn SetOkButtonLabel(&self, t: &PCWSTR) -> Result<()> {
                self.core.st.borrow_mut().ok_label = pcwstr(t);
                unsafe { self.core.inner.SetOkButtonLabel(*t) }
            }
            fn SetFileNameLabel(&self, t: &PCWSTR) -> Result<()> {
                unsafe { self.core.inner.SetFileNameLabel(*t) }
            }
            fn GetResult(&self) -> Result<IShellItem> {
                if let Some(r) = self.core.result() {
                    return item(&r[0]);
                }
                unsafe { self.core.inner.GetResult() }
            }
            fn AddPlace(&self, psi: Ref<IShellItem>, fdap: FDAP) -> Result<()> {
                unsafe { self.core.inner.AddPlace(psi.ok()?, fdap) }
            }
            fn SetDefaultExtension(&self, e: &PCWSTR) -> Result<()> {
                self.core.st.borrow_mut().default_ext = pcwstr(e);
                unsafe { self.core.inner.SetDefaultExtension(*e) }
            }
            fn Close(&self, hr: HRESULT) -> Result<()> {
                unsafe { self.core.inner.Close(hr) }
            }
            fn SetClientGuid(&self, g: *const GUID) -> Result<()> {
                unsafe { self.core.inner.SetClientGuid(g) }
            }
            fn ClearClientData(&self) -> Result<()> {
                unsafe { self.core.inner.ClearClientData() }
            }
            fn SetFilter(&self, f: Ref<IShellItemFilter>) -> Result<()> {
                self.core.mark_custom();
                unsafe { self.core.inner.SetFilter(f.ok()?) }
            }
        }

        impl IFileDialog2_Impl for $t {
            fn SetCancelButtonLabel(&self, t: &PCWSTR) -> Result<()> {
                unsafe { self.core.inner.cast::<IFileDialog2>()?.SetCancelButtonLabel(*t) }
            }
            fn SetNavigationRoot(&self, psi: Ref<IShellItem>) -> Result<()> {
                self.core.mark_custom();
                unsafe { self.core.inner.cast::<IFileDialog2>()?.SetNavigationRoot(psi.ok()?) }
            }
        }

        impl IObjectWithSite_Impl for $t {
            fn SetSite(&self, site: Ref<IUnknown>) -> Result<()> {
                unsafe { self.core.inner.cast::<IObjectWithSite>()?.SetSite(site.as_ref()) }
            }
            fn GetSite(&self, riid: *const GUID, out: *mut *mut c_void) -> Result<()> {
                let s = self.core.inner.cast::<IObjectWithSite>()?;
                unsafe { (Interface::vtable(&s).GetSite)(Interface::as_raw(&s), riid, out).ok() }
            }
        }

        impl IFileDialogCustomize_Impl for $t {
            fn EnableOpenDropDown(&self, id: u32) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.EnableOpenDropDown(id) } }
            fn AddMenu(&self, id: u32, l: &PCWSTR) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddMenu(id, *l) } }
            fn AddPushButton(&self, id: u32, l: &PCWSTR) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddPushButton(id, *l) } }
            fn AddComboBox(&self, id: u32) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddComboBox(id) } }
            fn AddRadioButtonList(&self, id: u32) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddRadioButtonList(id) } }
            fn AddCheckButton(&self, id: u32, l: &PCWSTR, b: BOOL) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddCheckButton(id, *l, b.as_bool()) } }
            fn AddEditBox(&self, id: u32, t: &PCWSTR) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddEditBox(id, *t) } }
            fn AddSeparator(&self, id: u32) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddSeparator(id) } }
            fn AddText(&self, id: u32, t: &PCWSTR) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddText(id, *t) } }
            fn SetControlLabel(&self, id: u32, l: &PCWSTR) -> Result<()> { unsafe { self.c()?.SetControlLabel(id, *l) } }
            fn GetControlState(&self, id: u32) -> Result<CDCONTROLSTATEF> { unsafe { self.c()?.GetControlState(id) } }
            fn SetControlState(&self, id: u32, s: CDCONTROLSTATEF) -> Result<()> { unsafe { self.c()?.SetControlState(id, s) } }
            fn GetEditBoxText(&self, id: u32) -> Result<*mut u16> { unsafe { self.c()?.GetEditBoxText(id) } }
            fn SetEditBoxText(&self, id: u32, t: &PCWSTR) -> Result<()> { unsafe { self.c()?.SetEditBoxText(id, *t) } }
            fn GetCheckButtonState(&self, id: u32) -> Result<BOOL> { unsafe { self.c()?.GetCheckButtonState(id) } }
            fn SetCheckButtonState(&self, id: u32, b: BOOL) -> Result<()> { unsafe { self.c()?.SetCheckButtonState(id, b.as_bool()) } }
            fn AddControlItem(&self, id: u32, item: u32, l: &PCWSTR) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.AddControlItem(id, item, *l) } }
            fn RemoveControlItem(&self, id: u32, item: u32) -> Result<()> { unsafe { self.c()?.RemoveControlItem(id, item) } }
            fn RemoveAllControlItems(&self, id: u32) -> Result<()> { unsafe { self.c()?.RemoveAllControlItems(id) } }
            fn GetControlItemState(&self, id: u32, item: u32) -> Result<CDCONTROLSTATEF> { unsafe { self.c()?.GetControlItemState(id, item) } }
            fn SetControlItemState(&self, id: u32, item: u32, s: CDCONTROLSTATEF) -> Result<()> { unsafe { self.c()?.SetControlItemState(id, item, s) } }
            fn GetSelectedControlItem(&self, id: u32) -> Result<u32> { unsafe { self.c()?.GetSelectedControlItem(id) } }
            fn SetSelectedControlItem(&self, id: u32, item: u32) -> Result<()> { unsafe { self.c()?.SetSelectedControlItem(id, item) } }
            fn StartVisualGroup(&self, id: u32, l: &PCWSTR) -> Result<()> { self.core.mark_custom(); unsafe { self.c()?.StartVisualGroup(id, *l) } }
            fn EndVisualGroup(&self) -> Result<()> { unsafe { self.c()?.EndVisualGroup() } }
            fn MakeProminent(&self, id: u32) -> Result<()> { unsafe { self.c()?.MakeProminent(id) } }
            fn SetControlItemText(&self, id: u32, item: u32, l: &PCWSTR) -> Result<()> { unsafe { self.c()?.SetControlItemText(id, item, *l) } }
        }

        impl $t {
            fn c(&self) -> Result<IFileDialogCustomize> {
                self.core.inner.cast::<IFileDialogCustomize>()
            }
        }
    };
}

common!(OpenDialog_Impl);
common!(SaveDialog_Impl);

impl IFileOpenDialog_Impl for OpenDialog_Impl {
    fn GetResults(&self) -> Result<IShellItemArray> {
        if let Some(r) = self.core.result() {
            return items(&r);
        }
        unsafe { self.core.inner.cast::<IFileOpenDialog>()?.GetResults() }
    }
    fn GetSelectedItems(&self) -> Result<IShellItemArray> {
        if let Some(r) = self.core.result() {
            return items(&r);
        }
        unsafe { self.core.inner.cast::<IFileOpenDialog>()?.GetSelectedItems() }
    }
}

impl IFileSaveDialog_Impl for SaveDialog_Impl {
    fn SetSaveAsItem(&self, psi: Ref<IShellItem>) -> Result<()> {
        let i = psi.ok()?;
        if let Some(p) = path_of(i) {
            let path = std::path::Path::new(&p);
            let mut st = self.core.st.borrow_mut();
            st.folder = path.parent().map(|d| d.to_string_lossy().to_string());
            st.file_name = path.file_name().map(|n| n.to_string_lossy().to_string());
        }
        unsafe { self.s()?.SetSaveAsItem(i) }
    }
    fn SetProperties(&self, store: Ref<IPropertyStore>) -> Result<()> {
        unsafe { self.s()?.SetProperties(store.ok()?) }
    }
    fn SetCollectedProperties(&self, list: Ref<IPropertyDescriptionList>, append: BOOL) -> Result<()> {
        unsafe { self.s()?.SetCollectedProperties(list.as_ref(), append.as_bool()) }
    }
    fn GetProperties(&self) -> Result<IPropertyStore> {
        unsafe { self.s()?.GetProperties() }
    }
    fn ApplyProperties(&self, psi: Ref<IShellItem>, store: Ref<IPropertyStore>, hwnd: HWND, sink: Ref<IFileOperationProgressSink>) -> Result<()> {
        unsafe { self.s()?.ApplyProperties(psi.ok()?, store.ok()?, hwnd, sink.as_ref()) }
    }
}

impl SaveDialog_Impl {
    fn s(&self) -> Result<IFileSaveDialog> {
        self.core.inner.cast::<IFileSaveDialog>()
    }
}

/* ---------- class factory and DLL exports ---------- */

#[implement(IClassFactory)]
struct Factory {
    save: bool,
}

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<IUnknown>, iid: *const GUID, out: *mut *mut c_void) -> Result<()> {
        unsafe { *out = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let clsid = if self.save { CLSID_SAVE } else { CLSID_OPEN };
        let inner = real_dialog(&clsid)?;
        let unk: IUnknown = if self.save { SaveDialog { core: Core::new(inner, true) }.into() } else { OpenDialog { core: Core::new(inner, false) }.into() };
        unsafe { unk.query(iid, out).ok() }
    }
    fn LockServer(&self, _lock: BOOL) -> Result<()> {
        Ok(())
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, out: *mut *mut c_void) -> HRESULT {
    if out.is_null() || clsid.is_null() {
        return E_POINTER;
    }
    *out = std::ptr::null_mut();
    let save = match *clsid {
        CLSID_OPEN => false,
        CLSID_SAVE => true,
        _ => return CLASS_E_CLASSNOTAVAILABLE,
    };
    let f: IClassFactory = Factory { save }.into();
    f.query(iid, out)
}

/// Never unload: an app may still hold one of our dialogs.
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}
