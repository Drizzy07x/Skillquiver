# Slow / no internet

Isolate the layer first — adapter → gateway → DNS → internet. Read-only:

```powershell
Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, LinkSpeed, MediaType
Get-NetIPConfiguration | Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer
Test-NetConnection ((Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop | Select-Object -First 1)
Test-NetConnection 1.1.1.1                   # internet by IP — succeeds while browsing fails ⇒ DNS problem
Resolve-DnsName example.com                  # configured DNS
Resolve-DnsName example.com -Server 1.1.1.1  # bypass — only this works ⇒ configured DNS is the culprit
netsh wlan show interfaces                   # Wi-Fi: signal %, band; weak signal explains slowness by itself
```

## Repair ladder — climb only as far as evidence demands

| Evidence | Action |
|---|---|
| DNS-only failure | `Clear-DnsClientCache`; still failing → set adapter DNS (confirm): `Set-DnsClientServerAddress -InterfaceAlias '<alias>' -ServerAddresses 1.1.1.1,8.8.8.8`. Domain-joined machine (`(Get-CimInstance Win32_ComputerSystem).PartOfDomain`)? DON'T — public DNS breaks AD/internal names and the verify below won't catch it; report to IT instead |
| Gateway unreachable | Router/cable/Wi-Fi problem — power-cycle router, check link; not a Windows repair |
| Weak Wi-Fi signal | Distance/band (prefer 5 GHz); adapter driver only if the System log shows disconnects |
| Link speed far below plan (100 Mbps on gigabit) | Cable or negotiation — swap cable, NIC driver → `references/drivers.md` |
| All layers fail, config corrupt | Stack reset — restore point + confirm + reboot: `netsh winsock reset` then `netsh int ip reset` |

DNS change is trivially reversible: `Set-DnsClientServerAddress -InterfaceAlias '<alias>' -ResetServerAddresses`.

Verify: re-run the exact test that failed (Resolve-DnsName / Test-NetConnection / page load) after each rung — stop climbing the moment it passes.
