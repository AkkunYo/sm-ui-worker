# Multi-stage build for SM-Node (Cloudflare Worker Node Daemon)
FROM golang:alpine AS builder
WORKDIR /app
ARG TARGETOS TARGETARCH
ARG VERSION=dev
ARG COMMIT=none
COPY go.mod go.sum* ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build \
    -ldflags="-s -w -X 'main.Version=${VERSION}' -X 'main.GitCommit=${COMMIT}'" \
    -o /bin/sm-node main.go

# Compile official sing-box 1.14.2 with with_v2ray_api build tag
ARG SING_BOX_VERSION=1.14.2
ENV GOTOOLCHAIN=auto
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go install -v -trimpath \
    -ldflags="-s -w -buildid=" \
    -tags "with_quic,with_utls,with_clash_api,with_v2ray_api" \
    github.com/sagernet/sing-box/cmd/sing-box@v${SING_BOX_VERSION}

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata iptables iproute2 curl bash
WORKDIR /app
COPY --from=builder /bin/sm-node /usr/local/bin/sm-node
COPY --from=builder /go/bin/sing-box /usr/local/bin/sing-box

RUN set -eux; \
    chmod +x /usr/local/bin/sm-node /usr/local/bin/sing-box; \
    mkdir -p /var/lib/sm-ui/bin /var/lib/sm-ui/configs /var/lib/sm-ui/certs; \
    ln -sf /usr/local/bin/sing-box /var/lib/sm-ui/bin/sing-box; \
    sing-box version

ENTRYPOINT ["/usr/local/bin/sm-node"]
