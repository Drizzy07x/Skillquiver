# Missing / broken drivers

Detect (read-only):

```powershell
Get-PnpDevice -Status Error | Select-Object Status, Class, FriendlyName, InstanceId   # live problems
# Status Unknown = mostly disconnected ghosts — only relevant if the missing device should be present
Get-CimInstance Win32_PnPEntity -Filter "ConfigManagerErrorCode<>0" |
  Select-Object Name, ConfigManagerErrorCode, DeviceID
```

| Code | Meaning |
|---|---|
| 28 | No driver installed |
| 10 | Device cannot start — driver or hardware fault |
| 43 | Device reported failure (common on GPUs) |
| 31 / 39 / 52 | Driver load or signature problem |
| 45 | Device not currently connected — ghost, usually ignorable |

Install only through official channels — restore point before any install:

1. **Windows Update optional drivers:** Settings → Windows Update → Advanced options → Optional updates → Drivers. UI-only; no reliable built-in CLI — don't install PSWindowsUpdate without asking.
2. **Manufacturer package:** identify the hardware via `VEN_`/`DEV_` IDs in `InstanceId`, download from the vendor site, then `pnputil /add-driver <path>\driver.inf /install`.
3. **Code 45 ghosts:** no action.

Rollback (restore point first, same as install): prefer Device Manager → driver → Roll Back Driver — it reverts to the previous driver. `pnputil /delete-driver oemNN.inf /uninstall` REMOVES the package from the store: the device can end up with no driver at all (a NIC with no network left to re-download one) — last resort only.

Third-party driver-updater tools (DriverBooster and similar) → refuse per core gates, one line.

Verify: re-run `Get-PnpDevice` — device shows `Status OK` — and the original symptom (no audio, no Wi-Fi, ...) is gone.
