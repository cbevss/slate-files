//! System file icons, as PNG data URIs for the UI.
//!
//! Keys (chosen by the UI so identical icons are fetched once):
//!   "ext:pdf"  any file with that extension ("ext:" for no extension)
//!   "dir:"     a plain folder
//!   anything else is a real path (drives, special folders, .exe, .lnk …)
//!
//! Windows uses the shell's own icons. On Linux the UI keeps Slate's icons,
//! so this returns nothing there.

use std::collections::HashMap;

#[cfg(not(windows))]
pub fn icons(_keys: Vec<String>) -> HashMap<String, String> {
    HashMap::new()
}

#[cfg(windows)]
pub fn icons(keys: Vec<String>) -> HashMap<String, String> {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    keys.into_iter().filter_map(|k| imp::icon(&k).map(|v| (k, v))).collect()
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn shell_icons_become_pngs() {
        let got = super::icons(vec!["ext:pdf".into(), "ext:".into(), "dir:".into(), "C:\\".into()]);
        for k in ["ext:pdf", "ext:", "dir:", "C:\\"] {
            let v = got.get(k).unwrap_or_else(|| panic!("no icon for {k}"));
            assert!(v.starts_with("data:image/png;base64,") && v.len() > 200, "bad icon for {k}");
        }
    }
}

#[cfg(windows)]
mod imp {
    use base64::Engine;
    use windows::core::HSTRING;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES};
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    pub fn icon(key: &str) -> Option<String> {
        let (path, attrs, extra) = if let Some(e) = key.strip_prefix("ext:") {
            (if e.is_empty() { "file".to_string() } else { format!("file.{e}") }, FILE_ATTRIBUTE_NORMAL, SHGFI_USEFILEATTRIBUTES)
        } else if key == "dir:" {
            ("folder".to_string(), FILE_ATTRIBUTE_DIRECTORY, SHGFI_USEFILEATTRIBUTES)
        } else {
            let p = if key.len() == 2 && key.ends_with(':') { format!("{key}\\") } else { key.to_string() };
            (p, FILE_FLAGS_AND_ATTRIBUTES(0), SHGFI_FLAGS(0))
        };
        let mut info = SHFILEINFOW::default();
        let w = HSTRING::from(path);
        let ok = unsafe { SHGetFileInfoW(&w, attrs, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, SHGFI_ICON | SHGFI_LARGEICON | extra) };
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let png = to_png(info.hIcon);
        unsafe {
            let _ = DestroyIcon(info.hIcon);
        }
        png.map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
    }

    fn bits(dc: HDC, bmp: HBITMAP, w: i32, h: i32) -> Option<Vec<u8>> {
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let n = unsafe { GetDIBits(dc, bmp, 0, h as u32, Some(buf.as_mut_ptr() as _), &mut bi, DIB_RGB_COLORS) };
        (n != 0).then_some(buf)
    }

    fn to_png(icon: HICON) -> Option<Vec<u8>> {
        let mut ii = ICONINFO::default();
        unsafe { GetIconInfo(icon, &mut ii) }.ok()?;
        let result = (|| {
            let mut bm = BITMAP::default();
            let got = unsafe { GetObjectW(ii.hbmColor.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as _)) };
            if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
                return None;
            }
            let (w, h) = (bm.bmWidth, bm.bmHeight);
            let dc = unsafe { CreateCompatibleDC(None) };
            let mut px = bits(dc, ii.hbmColor, w, h);
            // old-style icons have no alpha channel: take transparency from the mask
            if let Some(p) = px.as_mut() {
                if p.chunks(4).all(|c| c[3] == 0) {
                    if let Some(mask) = bits(dc, ii.hbmMask, w, h) {
                        for (c, m) in p.chunks_mut(4).zip(mask.chunks(4)) {
                            c[3] = if m[0] == 0 { 255 } else { 0 };
                        }
                    }
                }
                for c in p.chunks_mut(4) {
                    c.swap(0, 2); // BGRA -> RGBA
                }
            }
            unsafe {
                let _ = DeleteDC(dc);
            }
            let px = px?;
            let mut out = Vec::new();
            {
                let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
                enc.set_color(png::ColorType::Rgba);
                enc.set_depth(png::BitDepth::Eight);
                let mut wr = enc.write_header().ok()?;
                wr.write_image_data(&px).ok()?;
            }
            Some(out)
        })();
        unsafe {
            let _ = DeleteObject(ii.hbmColor.into());
            let _ = DeleteObject(ii.hbmMask.into());
        }
        result
    }
}
