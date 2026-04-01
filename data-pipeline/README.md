# proton-pulse-data

Monthly-updated GitHub Pages CDN for ProtonDB per-game community reports.
Consumed by the [decky-proton-pulse](https://github.com/mdeguzis/decky-proton-pulse) plugin.

## Endpoint

```
GET https://mdeguzis.github.io/proton-pulse-data/data/{appId}.json
GET https://mdeguzis.github.io/proton-pulse-data/index.json
```

## Data format

Each `data/{appId}.json` is a minified JSON array sorted newest-first:

```json
[
  {
    "pv":  "Proton 8.0-5",
    "v":   "yes",
    "gpu": "AMD Radeon RX 6800 XT",
    "drv": "Mesa 23.1.0",
    "os":  "Arch Linux",
    "ts":  1693526400
  }
]
```

| Field | Source field | Meaning |
|-------|-------------|---------|
| `pv`  | `responses.protonVersion` | Proton version used |
| `v`   | `responses.verdict` | `yes` = works, `no` = broken |
| `gpu` | `systemInfo.gpu` | Reporter GPU string |
| `drv` | `systemInfo.gpuDriver` | Driver version string |
| `os`  | `systemInfo.os` | Reporter distro |
| `ts`  | `timestamp` | Unix epoch of report |

## Update schedule

Runs automatically on the 2nd of each month via GitHub Actions.
Source: [bdefore/protondb-data](https://github.com/bdefore/protondb-data) monthly dumps.

## Triggering manually

Go to **Actions → Update ProtonDB Data → Run workflow**.
You can optionally supply a direct dump URL to use a specific month's data.

## Storage strategy

The `gh-pages` branch is an orphan with a single commit — it is force-pushed
each run so no history accumulates. Repo size equals the current dataset only.
Games with fewer than 3 reports are excluded to keep the dataset useful.
