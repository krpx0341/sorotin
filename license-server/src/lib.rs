//! License core: Crockford keys, Ed25519 leases, SQLite, HTTP handlers.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PRODUCT: &str = "sorotin";
pub const DEFAULT_BIND: &str = "0.0.0.0:8787";
pub const LEASE_TTL_SECS: i64 = 30 * 24 * 3600;
pub const GRACE_SECS: i64 = 7 * 24 * 3600;

const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn encode_crockford(bytes: &[u8]) -> String {
    let mut bits: u32 = 0;
    let mut nbits: u32 = 0;
    let mut out = String::new();
    for &b in bytes {
        bits = (bits << 8) | u32::from(b);
        nbits += 8;
        while nbits >= 5 {
            nbits -= 5;
            let idx = ((bits >> nbits) & 31) as usize;
            out.push(CROCKFORD[idx] as char);
        }
    }
    if nbits > 0 {
        let idx = ((bits << (5 - nbits)) & 31) as usize;
        out.push(CROCKFORD[idx] as char);
    }
    out
}

pub fn normalize_key(raw: &str) -> Result<String> {
    let mut chars = String::new();
    for c in raw.chars() {
        if c == '-' || c.is_whitespace() {
            continue;
        }
        let u = c.to_ascii_uppercase();
        let mapped = match u {
            'I' | 'L' => '1',
            'O' => '0',
            'U' => 'V',
            '0'..='9' | 'A'..='H' | 'J' | 'K' | 'M' | 'N' | 'P'..='T' | 'V'..='Z' => u,
            _ => return Err(Error::Msg("kunci lisensi tidak valid".into())),
        };
        chars.push(mapped);
    }
    let body = chars.strip_prefix("SRT").unwrap_or(&chars);
    if body.len() != 16 {
        return Err(Error::Msg("kunci lisensi tidak valid".into()));
    }
    Ok(format!(
        "SRT-{}-{}-{}-{}",
        &body[0..4],
        &body[4..8],
        &body[8..12],
        &body[12..16]
    ))
}

pub fn key_hash(normalized: &str) -> String {
    hex::encode(Sha256::digest(normalized.as_bytes()))
}

pub fn mint_key() -> Result<String> {
    let mut bytes = [0u8; 10];
    getrandom::getrandom(&mut bytes).map_err(|e| Error::Msg(e.to_string()))?;
    let body = encode_crockford(&bytes);
    debug_assert!(body.len() >= 16);
    normalize_key(&format!("SRT{}", &body[..16]))
}

pub fn canonical_json(v: &Value) -> String {
    let Some(obj) = v.as_object() else {
        return v.to_string();
    };
    let mut keys: Vec<&String> = obj.keys().filter(|k| *k != "sig").collect();
    keys.sort();
    let mut out = Map::new();
    for k in keys {
        if let Some(val) = obj.get(k) {
            if !val.is_null() {
                out.insert(k.clone(), val.clone());
            }
        }
    }
    Value::Object(out).to_string()
}

pub fn generate_signing_key() -> Result<SigningKey> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| Error::Msg(e.to_string()))?;
    Ok(SigningKey::from_bytes(&bytes))
}

pub fn verifying_hex(signing: &SigningKey) -> String {
    hex::encode(signing.verifying_key().to_bytes())
}

pub fn sign_lease(signing: &SigningKey, payload: &Value) -> Result<Value> {
    let msg = canonical_json(payload);
    let sig = signing.sign(msg.as_bytes());
    let mut obj = payload
        .as_object()
        .cloned()
        .ok_or_else(|| Error::Msg("lease bukan object".into()))?;
    obj.insert("sig".into(), json!(B64.encode(sig.to_bytes())));
    Ok(Value::Object(obj))
}

pub fn verify_lease(pub_hex: &str, lease: &Value) -> Result<()> {
    let pk_bytes = hex::decode(pub_hex.trim()).map_err(|_| Error::Msg("public key rusak".into()))?;
    let pk_arr: [u8; 32] = pk_bytes
        .try_into()
        .map_err(|_| Error::Msg("public key harus 32 byte".into()))?;
    let vk = VerifyingKey::from_bytes(&pk_arr).map_err(|e| Error::Msg(e.to_string()))?;
    let sig_b64 = lease
        .get("sig")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::Msg("lease tanpa tanda tangan".into()))?;
    let sig_bytes = B64
        .decode(sig_b64)
        .map_err(|_| Error::Msg("tanda tangan rusak".into()))?;
    let sig_arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| Error::Msg("tanda tangan harus 64 byte".into()))?;
    let sig = Signature::from_bytes(&sig_arr);
    vk.verify(canonical_json(lease).as_bytes(), &sig)
        .map_err(|_| Error::Msg("tanda tangan lisensi tidak cocok".into()))?;
    Ok(())
}

pub struct Paths {
    pub dir: PathBuf,
    pub secret: PathBuf,
    pub public: PathBuf,
    pub db: PathBuf,
}

impl Paths {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            secret: dir.join("ed25519.sec"),
            public: dir.join("ed25519.pub"),
            db: dir.join("license.sqlite"),
            dir,
        }
    }
}

pub fn init_store(paths: &Paths) -> Result<SigningKey> {
    std::fs::create_dir_all(&paths.dir)?;
    let signing = if paths.secret.exists() {
        let hex_str = std::fs::read_to_string(&paths.secret)?;
        let bytes = hex::decode(hex_str.trim()).map_err(|_| Error::Msg("ed25519.sec rusak".into()))?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| Error::Msg("ed25519.sec harus 32 byte hex".into()))?;
        SigningKey::from_bytes(&arr)
    } else {
        let signing = generate_signing_key()?;
        std::fs::write(&paths.secret, hex::encode(signing.to_bytes()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = std::fs::metadata(&paths.secret)?.permissions();
            p.set_mode(0o600);
            std::fs::set_permissions(&paths.secret, p)?;
        }
        signing
    };
    std::fs::write(&paths.public, verifying_hex(&signing))?;
    let db = Connection::open(&paths.db)?;
    migrate(&db)?;
    Ok(signing)
}

pub fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=4000;
        CREATE TABLE IF NOT EXISTS licenses (
            id TEXT PRIMARY KEY,
            key_hash TEXT UNIQUE NOT NULL,
            key_suffix TEXT NOT NULL,
            label TEXT,
            seats INTEGER NOT NULL DEFAULT 1,
            expires_at INTEGER,
            revoked INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activations (
            license_id TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            hostname TEXT,
            app_version TEXT,
            last_seen INTEGER NOT NULL,
            PRIMARY KEY (license_id, machine_id)
        );
        ",
    )?;
    Ok(())
}

pub fn open_db(path: &Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    migrate(&db)?;
    Ok(db)
}

pub fn mint(
    db: &Connection,
    seats: u32,
    label: Option<&str>,
    days: Option<u32>,
) -> Result<(String, String)> {
    let key = mint_key()?;
    let id = key_hash(&key)[..16].to_string();
    let suffix = key[key.len().saturating_sub(4)..].to_string();
    let expires = days.map(|d| now_secs() + i64::from(d) * 86400);
    db.execute(
        "INSERT INTO licenses (id, key_hash, key_suffix, label, seats, expires_at, revoked, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        params![
            id,
            key_hash(&key),
            suffix,
            label,
            seats as i64,
            expires,
            now_secs()
        ],
    )?;
    Ok((id, key))
}

pub fn list_licenses(db: &Connection) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(
        "SELECT l.id, l.key_suffix, l.label, l.seats, l.expires_at, l.revoked, l.created_at,
                (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id) AS used
         FROM licenses l ORDER BY l.created_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(json!({
            "id": r.get::<_, String>(0)?,
            "suffix": r.get::<_, String>(1)?,
            "label": r.get::<_, Option<String>>(2)?,
            "seats": r.get::<_, i64>(3)?,
            "expires_at": r.get::<_, Option<i64>>(4)?,
            "revoked": r.get::<_, i64>(5)? != 0,
            "created_at": r.get::<_, i64>(6)?,
            "used": r.get::<_, i64>(7)?,
        }))
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn revoke(db: &Connection, key_or_id: &str) -> Result<bool> {
    let n = if let Ok(norm) = normalize_key(key_or_id) {
        db.execute(
            "UPDATE licenses SET revoked = 1 WHERE key_hash = ?1",
            params![key_hash(&norm)],
        )?
    } else {
        db.execute("UPDATE licenses SET revoked = 1 WHERE id = ?1", params![key_or_id])?
    };
    Ok(n > 0)
}

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<Connection>>,
    signing: Arc<SigningKey>,
}

#[derive(Deserialize)]
struct ActivateReq {
    key: String,
    machine_id: String,
    hostname: Option<String>,
    app_version: Option<String>,
}

#[derive(Deserialize)]
struct LeaseReq {
    lease: Value,
}

fn issue_lease(
    signing: &SigningKey,
    key_id: &str,
    machine_id: &str,
    seats: i64,
    license_exp: Option<i64>,
) -> Result<Value> {
    let issued = now_secs();
    let mut exp = issued + LEASE_TTL_SECS;
    if let Some(lim) = license_exp {
        if lim > 0 {
            exp = exp.min(lim);
        }
    }
    let payload = json!({
        "v": 1,
        "product": PRODUCT,
        "key_id": key_id,
        "machine_id": machine_id,
        "seats": seats,
        "issued_at": issued,
        "expires_at": exp,
        "grace_until": exp + GRACE_SECS,
    });
    sign_lease(signing, &payload)
}

fn lookup_license(db: &Connection, key: &str) -> Result<Option<(String, i64, Option<i64>, i64)>> {
    let norm = normalize_key(key)?;
    let mut stmt = db.prepare(
        "SELECT id, seats, expires_at, revoked FROM licenses WHERE key_hash = ?1",
    )?;
    let mut rows = stmt.query(params![key_hash(&norm)])?;
    if let Some(r) = rows.next()? {
        Ok(Some((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
        )))
    } else {
        Ok(None)
    }
}

fn activation_count(db: &Connection, license_id: &str) -> Result<i64> {
    let n: i64 = db.query_row(
        "SELECT COUNT(*) FROM activations WHERE license_id = ?1",
        params![license_id],
        |r| r.get(0),
    )?;
    Ok(n)
}

fn upsert_activation(
    db: &Connection,
    license_id: &str,
    machine_id: &str,
    hostname: Option<&str>,
    app_version: Option<&str>,
) -> Result<()> {
    db.execute(
        "INSERT INTO activations (license_id, machine_id, hostname, app_version, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(license_id, machine_id) DO UPDATE SET
            hostname = excluded.hostname,
            app_version = excluded.app_version,
            last_seen = excluded.last_seen",
        params![license_id, machine_id, hostname, app_version, now_secs()],
    )?;
    Ok(())
}

fn err_json(status: StatusCode, msg: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "ok": false, "error": msg })))
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "product": PRODUCT }))
}

async fn info(State(st): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "product": PRODUCT,
        "pubkey": verifying_hex(&st.signing),
    }))
}

async fn activate(
    State(st): State<AppState>,
    Json(req): Json<ActivateReq>,
) -> (StatusCode, Json<Value>) {
    if req.machine_id.trim().len() < 8 {
        return err_json(StatusCode::BAD_REQUEST, "machine_id terlalu pendek");
    }
    let db = st.db.lock().expect("db");
    let Some((id, seats, exp, revoked)) = (match lookup_license(&db, &req.key) {
        Ok(v) => v,
        Err(e) => return err_json(StatusCode::BAD_REQUEST, &e.to_string()),
    }) else {
        return err_json(StatusCode::NOT_FOUND, "kunci tidak dikenal");
    };
    if revoked != 0 {
        return err_json(StatusCode::FORBIDDEN, "kunci dicabut");
    }
    if let Some(exp) = exp {
        if now_secs() > exp {
            return err_json(StatusCode::FORBIDDEN, "kunci kedaluwarsa");
        }
    }
    let already: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM activations WHERE license_id = ?1 AND machine_id = ?2",
            params![id, req.machine_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if already == 0 {
        let used = match activation_count(&db, &id) {
            Ok(n) => n,
            Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
        if used >= seats {
            return err_json(StatusCode::CONFLICT, "semua kursi sudah terpakai");
        }
    }
    if let Err(e) = upsert_activation(
        &db,
        &id,
        &req.machine_id,
        req.hostname.as_deref(),
        req.app_version.as_deref(),
    ) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    match issue_lease(&st.signing, &id, &req.machine_id, seats, exp) {
        Ok(lease) => (StatusCode::OK, Json(json!({ "ok": true, "lease": lease }))),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

fn license_from_lease(db: &Connection, lease: &Value) -> Result<(String, i64, Option<i64>, i64, String)> {
    let key_id = lease
        .get("key_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::Msg("lease tanpa key_id".into()))?;
    let machine_id = lease
        .get("machine_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::Msg("lease tanpa machine_id".into()))?;
    let mut stmt = db.prepare(
        "SELECT id, seats, expires_at, revoked FROM licenses WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![key_id])?;
    let Some(r) = rows.next()? else {
        return Err(Error::Msg("lisensi tidak ditemukan".into()));
    };
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, machine_id.to_string()))
}

async fn heartbeat(
    State(st): State<AppState>,
    Json(req): Json<LeaseReq>,
) -> (StatusCode, Json<Value>) {
    if verify_lease(&verifying_hex(&st.signing), &req.lease).is_err() {
        return err_json(StatusCode::FORBIDDEN, "lease tidak valid");
    }
    let db = st.db.lock().expect("db");
    let (id, seats, exp, revoked, machine_id) = match license_from_lease(&db, &req.lease) {
        Ok(v) => v,
        Err(e) => return err_json(StatusCode::FORBIDDEN, &e.to_string()),
    };
    if revoked != 0 {
        return err_json(StatusCode::FORBIDDEN, "kunci dicabut");
    }
    if let Some(exp) = exp {
        if now_secs() > exp {
            return err_json(StatusCode::FORBIDDEN, "kunci kedaluwarsa");
        }
    }
    if let Err(e) = upsert_activation(&db, &id, &machine_id, None, None) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    match issue_lease(&st.signing, &id, &machine_id, seats, exp) {
        Ok(lease) => (StatusCode::OK, Json(json!({ "ok": true, "lease": lease }))),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn deactivate(
    State(st): State<AppState>,
    Json(req): Json<LeaseReq>,
) -> (StatusCode, Json<Value>) {
    if verify_lease(&verifying_hex(&st.signing), &req.lease).is_err() {
        return err_json(StatusCode::FORBIDDEN, "lease tidak valid");
    }
    let db = st.db.lock().expect("db");
    let (id, _seats, _exp, _rev, machine_id) = match license_from_lease(&db, &req.lease) {
        Ok(v) => v,
        Err(e) => return err_json(StatusCode::FORBIDDEN, &e.to_string()),
    };
    let _ = db.execute(
        "DELETE FROM activations WHERE license_id = ?1 AND machine_id = ?2",
        params![id, machine_id],
    );
    (StatusCode::OK, Json(json!({ "ok": true })))
}

pub fn router(db: Connection, signing: SigningKey) -> Router {
    let state = AppState {
        db: Arc::new(Mutex::new(db)),
        signing: Arc::new(signing),
    };
    Router::new()
        .route("/health", get(health))
        .route("/v1/info", get(info))
        .route("/v1/activate", post(activate))
        .route("/v1/heartbeat", post(heartbeat))
        .route("/v1/deactivate", post(deactivate))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_roundtrip_and_typos() {
        let k = mint_key().unwrap();
        assert!(k.starts_with("SRT-"));
        assert_eq!(normalize_key(&k.to_lowercase()).unwrap(), k);
        let fuzzy = k.replace('0', "O");
        assert_eq!(normalize_key(&fuzzy).unwrap(), k);
    }

    #[test]
    fn canonical_skips_sig_and_sorts() {
        let v = json!({"sig":"x","b":2,"a":1});
        assert_eq!(canonical_json(&v), r#"{"a":1,"b":2}"#);
    }

    #[test]
    fn sign_and_verify_with_fixed_seed() {
        let seed = [0x11u8; 32];
        let signing = SigningKey::from_bytes(&seed);
        let payload = json!({
            "v": 1,
            "product": "sorotin",
            "key_id": "abcd",
            "machine_id": "m1",
            "seats": 1,
            "issued_at": 1,
            "expires_at": 2,
            "grace_until": 3
        });
        let lease = sign_lease(&signing, &payload).unwrap();
        verify_lease(&verifying_hex(&signing), &lease).unwrap();
        let mut bad = lease.clone();
        bad.as_object_mut().unwrap().insert("seats".into(), json!(9));
        assert!(verify_lease(&verifying_hex(&signing), &bad).is_err());
    }
}
