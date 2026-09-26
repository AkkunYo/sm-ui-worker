# Multi-stage build for SM-Node (Cloudflare Worker Node Daemon)
FROM --platform=$BUILDPLATFORM golang:alpine AS builder
WORKDIR /app
ARG TARGETOS TARGETARCH
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o /bin/sm-node main.go

FROM alpine:3.20
ARG TARGETARCH
RUN apk add --no-cache ca-certificates tzdata iptables iproute2 curl bash tar gzip
WORKDIR /app
COPY --from=builder /bin/sm-node /usr/local/bin/sm-node

# Pre-install official sing-box core binary
ARG SING_BOX_VERSION=1.11.4
RUN set -eux; \
    ARCH="${TARGETARCH:-amd64}"; \
    case "${ARCH}" in \
        amd64) SB_ARCH="amd64" ;; \
        arm64) SB_ARCH="arm64" ;; \
        *) SB_ARCH="${ARCH}" ;; \
    esac; \
    curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-linux-${SB_ARCH}.tar.gz" -o /tmp/sb.tar.gz; \
    tar -xzf /tmp/sb.tar.gz -C /tmp; \
    mv /tmp/sing-box-*/sing-box /usr/local/bin/sing-box; \
    chmod +x /usr/local/bin/sing-box; \
    rm -rf /tmp/sb.tar.gz /tmp/sing-box-*; \
    mkdir -p /var/lib/sm-ui/bin /var/lib/sm-ui/configs /var/lib/sm-ui/certs; \
    ln -sf /usr/local/bin/sing-box /var/lib/sm-ui/bin/sing-box; \
    sing-box version

ENTRYPOINT ["/usr/local/bin/sm-node"]
