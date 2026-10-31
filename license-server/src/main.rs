use clap::{Parser, Subcommand};
use sorotin_license::{
    init_store, list_licenses, mint, open_db, revoke, router, verifying_hex, Paths, DEFAULT_BIND,
};
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "sorotin-license", about = "Sorotin license server (Artemis / Studio-Redigma)")]
struct Cli {
    #[arg(long, env = "SOROTIN_LICENSE_DATA", global = true)]
    data: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create data dir, Ed25519 keypair, and SQLite file.
    Init,
    /// Print a new license key (shown once).
    Mint {
        #[arg(long, default_value_t = 1)]
        seats: u32,
        #[arg(long)]
        label: Option<String>,
        /// 0 = no expiry.
        #[arg(long, default_value_t = 0)]
        days: u32,
    },
    List,
    Revoke { key_or_id: String },
    Serve {
        #[arg(long, default_value = DEFAULT_BIND)]
        bind: String,
    },
}

fn data_dir(cli: &Cli) -> PathBuf {
    cli.data.clone().unwrap_or_else(|| {
        if cfg!(windows) {
            PathBuf::from("./data/license-server")
        } else if PathBuf::from("/var/lib/sorotin-license").exists()
            || std::env::var("SOROTIN_LICENSE_SYSTEM").ok().as_deref() == Some("1")
        {
            PathBuf::from("/var/lib/sorotin-license")
        } else {
            PathBuf::from("./data/license-server")
        }
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let paths = Paths::new(data_dir(&cli));
    match cli.cmd {
        Cmd::Init => {
            let signing = init_store(&paths)?;
            println!("data    {}", paths.dir.display());
            println!("pubkey  {}", verifying_hex(&signing));
            println!("copy pubkey into src/lib/license-pub.ts (LICENSE_PUB_HEX) then rebuild the app.");
        }
        Cmd::Mint { seats, label, days } => {
            let signing = init_store(&paths)?;
            let _ = signing;
            let db = open_db(&paths.db)?;
            let days = if days == 0 { None } else { Some(days) };
            let (id, key) = mint(&db, seats, label.as_deref(), days)?;
            println!("id     {id}");
            println!("seats  {seats}");
            println!("key    {key}");
            println!("store this key; it cannot be shown again.");
        }
        Cmd::List => {
            let db = open_db(&paths.db)?;
            for row in list_licenses(&db)? {
                println!("{}", serde_json::to_string(&row)?);
            }
        }
        Cmd::Revoke { key_or_id } => {
            let db = open_db(&paths.db)?;
            if revoke(&db, &key_or_id)? {
                println!("revoked");
            } else {
                eprintln!("not found");
                std::process::exit(1);
            }
        }
        Cmd::Serve { bind } => {
            let signing = init_store(&paths)?;
            let db = open_db(&paths.db)?;
            let addr: SocketAddr = bind.parse()?;
            println!(
                "sorotin-license listen {addr} pubkey {}",
                verifying_hex(&signing)
            );
            let app = router(db, signing);
            let listener = tokio::net::TcpListener::bind(addr).await?;
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = tokio::signal::ctrl_c().await;
                })
                .await?;
        }
    }
    Ok(())
}
