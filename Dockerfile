# syntax=docker/dockerfile:1.6

# ─── Stage 1: Build uberjar with Leiningen ───────────────────────────────────
FROM clojure:temurin-17-lein-2.11.2 AS build

WORKDIR /build

# Cache deps: copy project.clj first
COPY project.clj ./
RUN lein deps

# Copy source and build
COPY src ./src
COPY resources ./resources
COPY test ./test

RUN lein uberjar

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre

WORKDIR /app

COPY --from=build /build/target/bebetter-standalone.jar /app/app.jar

# Uploads directory (mounted as volume in compose)
RUN mkdir -p /app/uploads
VOLUME ["/app/uploads"]

ENV PORT=3000
EXPOSE 3000

# JVM tuning — Datomic peer + Jetty want ~512m headroom
ENV JAVA_OPTS="-Xmx512m -XX:+UseContainerSupport"

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
