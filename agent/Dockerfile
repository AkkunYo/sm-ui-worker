# Self-contained SM-Node container image (Fat binary with embedded sing-box)
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata iptables iproute2 curl bash
WORKDIR /app
ARG TARGETARCH
COPY dist/${TARGETARCH}/sm-node /usr/local/bin/sm-node
RUN set -eux; \
    chmod +x /usr/local/bin/sm-node; \
    mkdir -p /var/lib/sm-ui/bin /var/lib/sm-ui/configs /var/lib/sm-ui/certs

ENTRYPOINT ["/usr/local/bin/sm-node"]
