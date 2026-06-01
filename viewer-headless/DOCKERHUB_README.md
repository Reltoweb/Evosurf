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

Disclaimer: Never share your access key as it allows access to your EvoSurf viewer account.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ACCESS_KEY` | Yes | Your EvoSurf access key for authentication. |
| `SESSION_ID` | No | Unique viewer name. Recommended when running multiple containers. |
| `VIEWER_RUNTIME` | No | Runtime label reported to EvoSurf. Use `docker` for Docker installs. |
| `VIEWER_PLATFORM` | No | Platform label reported to EvoSurf. Use `linux` for VPS installs. |

## Docker Compose Examples

### Single Container

Create a `docker-compose.yml` file:

```yaml
services:
  viewer:
    image: evosurf/viewer:stable
    environment:
      - ACCESS_KEY=${ACCESS_KEY}
      - SESSION_ID=viewer-1
      - VIEWER_RUNTIME=docker
      - VIEWER_PLATFORM=linux
    restart: unless-stopped
    tmpfs:
      - /tmp
      - /dev/shm
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Create a `.env` file with your access key:

```bash
ACCESS_KEY=your_secret_access_key_here
```

Then run:

```bash
docker compose up -d
```

### Multiple Containers

To run multiple viewers simultaneously, create a `docker-compose.yml` file:

```yaml
services:
  viewer1:
    image: evosurf/viewer:stable
    environment:
      - ACCESS_KEY=${ACCESS_KEY}
      - SESSION_ID=viewer1
      - VIEWER_RUNTIME=docker
      - VIEWER_PLATFORM=linux
    restart: unless-stopped
    tmpfs:
      - /tmp
      - /dev/shm
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  viewer2:
    image: evosurf/viewer:stable
    environment:
      - ACCESS_KEY=${ACCESS_KEY}
      - SESSION_ID=viewer2
      - VIEWER_RUNTIME=docker
      - VIEWER_PLATFORM=linux
    restart: unless-stopped
    tmpfs:
      - /tmp
      - /dev/shm
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  viewer3:
    image: evosurf/viewer:stable
    environment:
      - ACCESS_KEY=${ACCESS_KEY}
      - SESSION_ID=viewer3
      - VIEWER_RUNTIME=docker
      - VIEWER_PLATFORM=linux
    restart: unless-stopped
    tmpfs:
      - /tmp
      - /dev/shm
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Create a `.env` file with your access key:

```bash
ACCESS_KEY=your_secret_access_key_here
```

Then run:

```bash
docker compose up -d
```

## Resource Recommendations

Memory: 1 GB minimum per container, 2 GB recommended.

CPU: 1 core minimum per container, 2 cores recommended.

tmpfs: Mount `/tmp` and `/dev/shm` as tmpfs for better browser performance.

Start with 1 to 3 viewers on a small VPS, then increase slowly if the logs stay stable.

## Useful Commands

View running containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

Stop all viewers:

```bash
docker compose down
```

## Links

- Website: https://www.evosurf.fr
- Releases: https://github.com/Reltoweb/Evosurf/releases
- Docker Hub: https://hub.docker.com/r/evosurf/viewer
