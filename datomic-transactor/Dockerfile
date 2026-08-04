# syntax=docker/dockerfile:1.6
#
# Datomic Pro dev transactor with H2 storage backed by a persistent volume.
# Storage lives in /var/lib/datomic (mount a Docker volume there).
#
# Datomic Pro binaries are on Maven Central since 2023 but the transactor
# distro isn't. We fetch it from Cognitect's public downloads.

FROM eclipse-temurin:17-jre

ARG DATOMIC_VERSION=1.0.7469

WORKDIR /opt

# ─── Fetch the transactor distribution ───────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip \
    && curl -fsSL -o datomic.zip \
       "https://datomic-pro-downloads.s3.amazonaws.com/${DATOMIC_VERSION}/datomic-pro-${DATOMIC_VERSION}.zip" \
    && unzip -q datomic.zip \
    && mv datomic-pro-${DATOMIC_VERSION} datomic \
    && rm datomic.zip \
    && apt-get purge -y curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/datomic

# ─── Transactor config ────────────────────────────────────────────────────────
# dev storage = embedded H2, file-based, persisted under /var/lib/datomic.
COPY transactor.properties /opt/datomic/config/transactor.properties

VOLUME ["/var/lib/datomic"]

EXPOSE 4334 4335 4336

CMD ["bin/transactor", "/opt/datomic/config/transactor.properties"]
