use std::net::SocketAddr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().init();
    let addr: SocketAddr = "127.0.0.1:8790".parse()?;
    tracing::info!(%addr, "pehle-api starting");
    Ok(())
}
