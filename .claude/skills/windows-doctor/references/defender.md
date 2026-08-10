# Windows Defender: exclusions, on/off, full disable

Escalate in order — exclusions solve most requests, temporary toggle solves the rest, full kill is the last resort. Stop at the first rung that meets the need.

State first (read-only):

```powershell
Get-MpComputerStatus | Select-Object AMRunningMode, RealTimeProtectionEnabled, IsTamperProtected, AntivirusSignatureLastUpdated
```

`AMRunningMode` = `Passive Mode` / `SxS Passive Mode` ⇒ a third-party AV owns real-time protection — toggling Defender changes nothing; look at that AV. `Not running` ⇒ Defender is disabled (policy, service, or replaced) — see what is actually registered: `Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct`.

## Exclusions — prefer these when the motive is a false positive or scan overhead

Protection stays on; solves most "disable Defender" requests:

```powershell
Add-MpPreference -ExclusionPath 'C:\path'   # also -ExclusionProcess 'name.exe', -ExclusionExtension '.ext'
Get-MpPreference | Select-Object ExclusionPath, ExclusionProcess, ExclusionExtension   # verify
# Undo: Remove-MpPreference -ExclusionPath 'C:\path'
```

## Toggle real-time protection

Admin. Confirm once with the user before turning off.

```powershell
Set-MpPreference -DisableRealtimeMonitoring $true    # off — $false turns it back on
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled   # MANDATORY — see below
```

- `IsTamperProtected = True` makes the off-toggle fail **silently**: the command returns success, the state does not change. `Get-MpComputerStatus` after every toggle is the only truth.
- Blocked by Tamper Protection → guide the user through the UI (Windows Security → Virus & threat protection → Manage settings → Real-time protection), then re-verify with `Get-MpComputerStatus`.
- Windows re-enables real-time protection on its own after a while — off is inherently temporary. If it is still off when the session's work is done, remind the user to re-enable.

Verify: `RealTimeProtectionEnabled` matches the requested state after every toggle.

## Kill completely (permanent)

Last resort — leaves the machine with **no antivirus**. State that plainly and confirm before starting. There is no clean one-command kill on Windows 11: the steps below are what actually holds, and some need a human at the machine.

**Reality check first:**
- `Set-MpPreference` and `sc stop WinDefend` do NOT survive — Tamper Protection reverts them and the service is PPL-protected (access denied even as admin).
- The old policy `DisableAntiSpyware` is **ignored** on current Windows 11 client builds — don't rely on it.
- The one supported way Defender steps fully aside on its own: **install a third-party AV** → Defender auto-switches to `Passive Mode`. Offer this first; it needs no hacks and is trivially reversible (uninstall the other AV).

If a real kill is still wanted:

1. **Tamper Protection OFF** — manual, no API by design: Windows Security → Virus & threat protection → Manage settings → Tamper Protection Off. Verify: `(Get-MpComputerStatus).IsTamperProtected` = `False`. Nothing below sticks until this is done.
2. Real-time + cloud off (admin): `Set-MpPreference -DisableRealtimeMonitoring $true -DisableIOAVProtection $true`.
3. **Disable the services** — the `WinDefend` service can't be stopped from a running session; set its start type in the registry, which applies on next boot (restore point first):

   ```powershell
   # runs, but the OS may re-protect these on modern builds — verify after reboot, don't assume success
   Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\WinDefend' Start 4 -Type DWord
   Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\Sense'     Start 4 -Type DWord
   ```

   If access is denied, the only reliable route is editing the same keys from **Safe Mode** (`bcdedit /set {current} safeboot minimal` → reboot). Guide the user; don't fake it.
4. Reboot, then verify: `Get-MpComputerStatus` → `AMRunningMode` = `Not running`, `RealTimeProtectionEnabled` = `False`.

Never use third-party "Defender remover" tools — they bundle junk and are unnecessary; the steps above are the whole method.

## Reactivate after a full kill

Reverse every step, then verify:

```powershell
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\WinDefend' Start 2 -Type DWord
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\Sense'     Start 3 -Type DWord
Set-MpPreference -DisableRealtimeMonitoring $false -DisableIOAVProtection $false
```

Then reboot and turn **Tamper Protection back ON** in the UI (leaving it off is the real risk). Verify healthy: `Get-MpComputerStatus | Select-Object AMRunningMode, RealTimeProtectionEnabled, IsTamperProtected` → `Normal`, `True`, `True`. If Defender won't start (services stripped, app package damaged), re-register it: `Get-AppxPackage -AllUsers *Defender* | Reset-AppxPackage` then reboot; still broken → `references/corruption-update.md` (DISM/SFC).
