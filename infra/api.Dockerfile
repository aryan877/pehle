# Pehle API. Builds against the committed .sqlx query metadata, so no database is needed at build time.
FROM rust:1.96-bookworm AS build
WORKDIR /src
ENV SQLX_OFFLINE=true CARGO_TERM_COLOR=never
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY .sqlx ./.sqlx
COPY db ./db
COPY crates ./crates
RUN cargo build --release --locked -p pehle-api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 pehle && mkdir -p /data/media && chown pehle /data/media
COPY --from=build /src/target/release/pehle-api /usr/local/bin/pehle-api
COPY scripts/demo-assets /opt/pehle/demo-assets
USER pehle
ENV PEHLE_BIND=0.0.0.0:8790 PEHLE_MEDIA_DIR=/data/media PEHLE_DEMO_ASSETS=/opt/pehle/demo-assets PEHLE_LOG_JSON=1 RUST_LOG=info,sqlx=warn
EXPOSE 8790
HEALTHCHECK --interval=15s --timeout=3s CMD curl -fsS http://127.0.0.1:8790/healthz || exit 1
ENTRYPOINT ["pehle-api"]
