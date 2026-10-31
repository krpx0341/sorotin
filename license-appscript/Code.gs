/**
 * Lisensi Sorotin di Google Sheet.
 *
 * Pasang:
 * 1. Buat Spreadsheet baru (mis. "Sorotin lisensi").
 * 2. Extensions → Apps Script. Tempel file ini. Save.
 * 3. Jalankan mintLicense sekali dari editor (izinkan akses). Atau reload sheet,
 *    menu Sorotin → Kunci baru.
 * 4. Deploy → New deployment → Web app.
 *    Execute as: Me. Who has access: Anyone.
 * 5. URL …/macros/s/…/exec tempel di Settings Sorotin → Server lisensi.
 *
 * Pantau: tab Lisensi (siapa pakai, last seen) dan tab Log (setiap activate/heartbeat).
 * Cabut: ubah kolom status jadi revoked, atau menu Cabut baris terpilih.
 */

var HEADERS = [
  "key",
  "label",
  "expires",
  "seats",
  "status",
  "machine_id",
  "hostname",
  "activated_at",
  "last_seen",
  "token",
  "app_version",
  "notes",
];
var LOG_HEADERS = ["time", "action", "key", "machine_id", "hostname", "result", "detail"];
var GRACE_SECS = 7 * 24 * 3600;
var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Sorotin")
    .addItem("Kunci baru…", "mintLicense")
    .addItem("Cabut baris terpilih", "revokeSelected")
    .addToUi();
  ss_();
}

function setup() {
  ss_();
}

var DEFAULT_SHEET_ID = "1akXBBnc23dfGVFawJiCZCt9DOHi8bfsbXVltQ41X-uI";

function ss_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID") || DEFAULT_SHEET_ID;
  var book = null;
  try {
    book = SpreadsheetApp.openById(id);
  } catch (e) {
    book = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!book) throw new Error("Spreadsheet lisensi tidak ditemukan.");
  props.setProperty("SHEET_ID", book.getId());
  ensureSheets_(book);
  return book;
}

function ensureSheets_(book) {
  var lisensi = book.getSheetByName("Lisensi");
  if (!lisensi) lisensi = book.insertSheet("Lisensi");
  if (lisensi.getLastRow() < 1) {
    lisensi.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    lisensi.setFrozenRows(1);
  }
  var log = book.getSheetByName("Log");
  if (!log) log = book.insertSheet("Log");
  if (log.getLastRow() < 1) {
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    log.setFrozenRows(1);
  }
}

function mintKey_() {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + new Date().toISOString()
  );
  var bits = 0;
  var n = 0;
  var out = "";
  for (var i = 0; i < 10; i++) {
    bits = (bits << 8) | (digest[i] & 255);
    n += 8;
    while (n >= 5) {
      n -= 5;
      out += ALPHA.charAt((bits >> n) & 31);
    }
  }
  return "SRT-" + out.slice(0, 4) + "-" + out.slice(4, 8) + "-" + out.slice(8, 12) + "-" + out.slice(12, 16);
}

function normalizeKey_(raw) {
  var chars = String(raw || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
  if (chars.indexOf("SRT") === 0) chars = chars.slice(3);
  if (chars.length !== 16) return "";
  return "SRT-" + chars.slice(0, 4) + "-" + chars.slice(4, 8) + "-" + chars.slice(8, 12) + "-" + chars.slice(12, 16);
}

function mintLicense() {
  var ui = SpreadsheetApp.getUi();
  var label = ui.prompt("Label (nama orang / mesin)", "Contoh: Budi laptop", ui.ButtonSet.OK_CANCEL);
  if (label.getSelectedButton() !== ui.Button.OK) return;
  var days = ui.prompt("Masa aktif (hari)", "90", ui.ButtonSet.OK_CANCEL);
  if (days.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(days.getResponseText(), 10);
  if (!(n > 0)) n = 90;
  var key = mintKey_();
  var exp = new Date();
  exp.setDate(exp.getDate() + n);
  var expIso = Utilities.formatDate(exp, Session.getScriptTimeZone() || "Asia/Jakarta", "yyyy-MM-dd");
  var sheet = ss_().getSheetByName("Lisensi");
  sheet.appendRow([key, label.getResponseText().trim(), expIso, 1, "issued", "", "", "", "", "", "", ""]);
  log_("mint", key, "", "", "ok", expIso);
  ui.alert("Kunci (disalin sekali, kirim ke pemakai):\n\n" + key + "\n\nSampai " + expIso);
}

function revokeSelected() {
  var range = SpreadsheetApp.getActiveRange();
  var sheet = range.getSheet();
  if (sheet.getName() !== "Lisensi") {
    SpreadsheetApp.getUi().alert("Pilih baris di tab Lisensi.");
    return;
  }
  var row = range.getRow();
  if (row < 2) return;
  sheet.getRange(row, 5).setValue("revoked");
  log_("revoke", String(sheet.getRange(row, 1).getValue()), "", "", "ok", "baris " + row);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, product: "sorotin" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action || "";
    if (action === "activate") return json_(activate_(body));
    if (action === "heartbeat") return json_(heartbeat_(body));
    if (action === "deactivate") return json_(deactivate_(body));
    return json_({ ok: false, error: "action tidak dikenal" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function col_(headers, name) {
  var i = headers.indexOf(name);
  return i < 0 ? -1 : i;
}

function loadRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) {
    return String(h);
  });
  return { headers: headers, values: values };
}

function findKeyRow_(values, headers, key) {
  var ki = col_(headers, "key");
  var want = normalizeKey_(key);
  if (!want) return -1;
  for (var r = 1; r < values.length; r++) {
    if (normalizeKey_(values[r][ki]) === want) return r;
  }
  return -1;
}

function expiresUnix_(cell) {
  if (!cell) return 0;
  var d = cell instanceof Date ? cell : new Date(cell);
  if (isNaN(d.getTime())) return 0;
  d.setHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

function nowUnix_() {
  return Math.floor(Date.now() / 1000);
}

function isoNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");
}

function log_(action, key, machine, host, result, detail) {
  ss_().getSheetByName("Log").appendRow([isoNow_(), action, key, machine, host, result, detail || ""]);
}

function leaseFromRow_(values, headers, row, machineId, token) {
  var get = function (name) {
    return values[row][col_(headers, name)];
  };
  var exp = expiresUnix_(get("expires"));
  var now = nowUnix_();
  return {
    v: 2,
    product: "sorotin",
    key: normalizeKey_(get("key")),
    key_id: String(get("key")).slice(-4),
    label: String(get("label") || ""),
    machine_id: machineId,
    token: token,
    seats: Number(get("seats") || 1),
    last_ok: now,
    issued_at: now,
    expires_at: exp || now + 90 * 86400,
    grace_until: (exp || now + 90 * 86400) + GRACE_SECS,
  };
}

function activate_(body) {
  var key = normalizeKey_(body.key);
  var machine = String(body.machine_id || "");
  var host = String(body.hostname || "");
  if (!key) return fail_("activate", body, "kunci lisensi tidak valid");
  if (machine.length < 8) return fail_("activate", body, "machine_id terlalu pendek");
  var sheet = ss_().getSheetByName("Lisensi");
  var loaded = loadRows_(sheet);
  var row = findKeyRow_(loaded.values, loaded.headers, key);
  if (row < 0) return fail_("activate", body, "kunci tidak dikenal");
  var get = function (name) {
    return loaded.values[row][col_(loaded.headers, name)];
  };
  var status = String(get("status") || "issued");
  if (status === "revoked") return fail_("activate", body, "kunci dicabut");
  var exp = expiresUnix_(get("expires"));
  if (exp && nowUnix_() > exp) return fail_("activate", body, "kunci kedaluwarsa");
  var bound = String(get("machine_id") || "");
  var seats = Number(get("seats") || 1);
  if (bound && bound !== machine && seats <= 1) {
    return fail_("activate", body, "kunci sudah terpakai di mesin lain");
  }
  var token = Utilities.getUuid().replace(/-/g, "");
  var now = isoNow_();
  sheet.getRange(row + 1, col_(loaded.headers, "status") + 1).setValue("active");
  sheet.getRange(row + 1, col_(loaded.headers, "machine_id") + 1).setValue(machine);
  sheet.getRange(row + 1, col_(loaded.headers, "hostname") + 1).setValue(host);
  if (!get("activated_at")) {
    sheet.getRange(row + 1, col_(loaded.headers, "activated_at") + 1).setValue(now);
  }
  sheet.getRange(row + 1, col_(loaded.headers, "last_seen") + 1).setValue(now);
  sheet.getRange(row + 1, col_(loaded.headers, "token") + 1).setValue(token);
  if (body.app_version) {
    sheet.getRange(row + 1, col_(loaded.headers, "app_version") + 1).setValue(String(body.app_version));
  }
  loaded = loadRows_(sheet);
  log_("activate", key, machine, host, "ok", host);
  return { ok: true, lease: leaseFromRow_(loaded.values, loaded.headers, row, machine, token) };
}

function readBound_(body) {
  var key = normalizeKey_(body.key || (body.lease && body.lease.key));
  var machine = String(body.machine_id || (body.lease && body.lease.machine_id) || "");
  var token = String(body.token || (body.lease && body.lease.token) || "");
  return { key: key, machine: machine, token: token, host: String(body.hostname || "") };
}

function fail_(action, body, msg) {
  var b = readBound_(body);
  log_(action, b.key, b.machine, b.host, "fail", msg);
  return { ok: false, error: msg };
}

function heartbeat_(body) {
  var b = readBound_(body);
  if (!b.key || !b.token) return fail_("heartbeat", body, "lease tidak lengkap");
  var sheet = ss_().getSheetByName("Lisensi");
  var loaded = loadRows_(sheet);
  var row = findKeyRow_(loaded.values, loaded.headers, b.key);
  if (row < 0) return fail_("heartbeat", body, "kunci tidak dikenal");
  var get = function (name) {
    return loaded.values[row][col_(loaded.headers, name)];
  };
  if (String(get("status")) === "revoked") return fail_("heartbeat", body, "kunci dicabut");
  var exp = expiresUnix_(get("expires"));
  if (exp && nowUnix_() > exp) return fail_("heartbeat", body, "kunci kedaluwarsa");
  if (String(get("machine_id")) !== b.machine) return fail_("heartbeat", body, "mesin tidak cocok");
  if (String(get("token")) !== b.token) return fail_("heartbeat", body, "token tidak cocok");
  sheet.getRange(row + 1, col_(loaded.headers, "last_seen") + 1).setValue(isoNow_());
  log_("heartbeat", b.key, b.machine, b.host, "ok", "");
  loaded = loadRows_(sheet);
  return { ok: true, lease: leaseFromRow_(loaded.values, loaded.headers, row, b.machine, b.token) };
}

function deactivate_(body) {
  var b = readBound_(body);
  var sheet = ss_().getSheetByName("Lisensi");
  var loaded = loadRows_(sheet);
  var row = findKeyRow_(loaded.values, loaded.headers, b.key);
  if (row < 0) return fail_("deactivate", body, "kunci tidak dikenal");
  var get = function (name) {
    return loaded.values[row][col_(loaded.headers, name)];
  };
  if (String(get("machine_id")) && String(get("machine_id")) !== b.machine) {
    return fail_("deactivate", body, "mesin tidak cocok");
  }
  if (String(get("token")) && b.token && String(get("token")) !== b.token) {
    return fail_("deactivate", body, "token tidak cocok");
  }
  sheet.getRange(row + 1, col_(loaded.headers, "status") + 1).setValue("issued");
  sheet.getRange(row + 1, col_(loaded.headers, "machine_id") + 1).setValue("");
  sheet.getRange(row + 1, col_(loaded.headers, "token") + 1).setValue("");
  log_("deactivate", b.key, b.machine, b.host, "ok", "");
  return { ok: true };
}
