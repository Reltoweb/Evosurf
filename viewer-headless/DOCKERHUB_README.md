# EvoSurf Viewer

Official Docker image for the EvoSurf headless viewer.

Run EvoSurf Viewer on a VPS or Linux server with your EvoSurf access key. The viewer runs in the background, receives visits from EvoSurf, and reports activity back to your dashboard.

## Quick Start

```bash
docker run -d \
  -e ACCESS_KEY=YOUR_ACCESS_KEY \
  --tmpfs /tmp \
  --tmpfs /dev/shm \
  evosurf/viewer:stable
```

Replace `YOUR_ACCESS_KEY` with the access key from your EvoSurf dashboard.

## Recommended VPS Setup

Docker Compose is recommended when running EvoSurf Viewer on a VPS.

```bash
mkdir -p ~/evosurf-viewer
cd ~/evosurf-viewer
curl -fsSL https://raw.githubusercontent.com/Reltoweb/Evosurf/main/viewer-headless/docker-compose.release.yml -o docker-compose.yml
nano docker-compose.yml
docker compose up -d
```

The default Compose file includes Watchtower, so your viewer can restart automatically when a new `evosurf/viewer:stable` image is published.

## Multiple Viewers

To run several viewer sessions on the same VPS, duplicate the viewer service in `docker-compose.yml`.

Each viewer should have:

- the same or another `ACCESS_KEY`
- a different `SESSION_ID`
- a unique service name

Example:

```yaml
services:
  viewer-1:
    image: evosurf/viewer:stable
    restart: unless-stopped
    environment:
      ACCESS_KEY: "YOUR_ACCESS_KEY"
      SESSION_ID: "viewer-1"
      VIEWER_RUNTIME: "docker"
      VIEWER_PLATFORM: "linux"

  viewer-2:
    image: evosurf/viewer:stable
    restart: unless-stopped
    environment:
      ACCESS_KEY: "YOUR_ACCESS_KEY"
      SESSION_ID: "viewer-2"
      VIEWER_RUNTIME: "docker"
      VIEWER_PLATFORM: "linux"

  viewer-3:
    image: evosurf/viewer:stable
    restart: unless-stopped
    environment:
      ACCESS_KEY: "YOUR_ACCESS_KEY"
      SESSION_ID: "viewer-3"
      VIEWER_RUNTIME: "docker"
      VIEWER_PLATFORM: "linux"

  watchtower:
    image: containrrr/watchtower:latest
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup viewer-1 viewer-2 viewer-3
```

Then start everything:

```bash
docker compose up -d
```

Check logs:

```bash
docker compose logs -f viewer-1
```

## Links

- Website: https://www.evosurf.fr
- Releases: https://github.com/Reltoweb/Evosurf/releases
- Docker Hub: https://hub.docker.com/r/evosurf/viewer
