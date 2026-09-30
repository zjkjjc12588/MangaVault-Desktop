FROM mcr.microsoft.com/devcontainers/typescript-node:22

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev librsvg2-dev p7zip-full poppler-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /workspace
