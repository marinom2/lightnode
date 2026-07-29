# Worker settings (`worker.local.env`)

Optional environment for the worker container that **survives a reinstall**.

Before this existed, adding anything to the worker's environment meant editing the
container by hand, and the next install from the app threw it away — the run
command is generated fresh each time, so a manually-added `-e` flag disappeared
with the old container. Nothing failed loudly; a capability simply stopped being
advertised.

## Where it goes

```
<keys-dir>/../worker.local.env
```

For a default install that is:

```
~/lightchain-worker/worker.local.env
```

The installer applies it with `docker run --env-file` when the file exists, and
prints `▶ applying operator settings from …` so you can see it took effect.

```bash
chmod 600 ~/lightchain-worker/worker.local.env   # it will hold credentials
```

## Precedence

This file is applied **before** the settings the installer manages
(`RPC_URL`, `CHAIN_ID`, `WORKER_REGISTRY_ADDRESS`, `AI_CONFIG_ADDRESS`,
`JOB_REGISTRY_ADDRESS`, `SUPPORTED_MODELS`, keystore paths, sortition config).

That ordering is deliberate: those values win. A stale local file must not be able
to repoint `RPC_URL` and leave a worker talking to the wrong chain while still
looking healthy.

Use it for capabilities and tuning, not for chain wiring.

## Web search

```ini
SEARCH_ENABLED=true
TAVILY_API_KEY=tvly-...
SEARCH_MAX_RESULTS=6
SEARCH_TIMEOUT=30s
```

> ### ⚠️ The variable is `SEARCH_ENABLED`, with a **D**
>
> `SEARCH_ENABLE` (no D) is read by nothing. Set it and the worker starts
> cleanly, reports healthy, and **never advertises search** — a silent failure
> with no error to notice and no log line to grep for.
>
> Verify against whatever image you are running rather than trusting this file:
>
> ```bash
> docker exec lightchain-worker sh -c \
>   "strings /bin/worker | grep -oE '\bSEARCH_[A-Z_]+\b'" | sort -u
> ```
>
> At the time of writing that returns exactly `SEARCH_ENABLED`, and
> `SEARCH_ENABLE` does not appear in the binary at all.

## Applying a change

The env of a running container cannot be altered, so it has to be recreated.
Re-running install from the app is the supported path and will pick the file up.

## Verifying

```bash
docker exec lightchain-worker env | grep -E '^SEARCH_|^TAVILY'
docker inspect lightchain-worker --format '{{.RestartCount}}'   # want 0
```

A non-zero and climbing restart count means the worker is crash-looping — check
`docker logs lightchain-worker`. A malformed line in this file (no `=`) will make
`docker run` reject the whole `--env-file`.

## Two things that will bite

**Run as root.** The installer starts the worker with `--user root`, and
`session-keys.enc` is written `root:root 0600`. Recreating the container without
`--user root` gives
`open /data/session-keys.enc: permission denied` in a restart loop.

**Chain settings are not optional.** This file alone is not a complete
environment. Starting a container with only `--env-file worker.local.env` fails
with `CHAIN_ID is required` and four siblings — the installer's `-e` flags supply
those.
