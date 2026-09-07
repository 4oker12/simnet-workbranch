# SIMNET Workbench HOME runtime configuration.
# Keep machine-specific values here. The runtime scripts never modify Vast itself.

$WorkbenchHomeConfig = [ordered]@{
    VastHost = '87.106.223.150'
    VastSshPort = 30036
    VastUser = 'root'

    LocalSocksPort = 25344
    RemoteSocksHost = '127.0.0.1'
    RemoteSocksPort = 25344

    LocalAsrPort = 8090
    RemoteAsrHost = '127.0.0.1'
    RemoteAsrPort = 8000

    PacPort = 8765
    PacPath = Join-Path $env:USERPROFILE 'simnet-vast.pac'
    PacDirectory = $env:USERPROFILE

    AsrHealthUrl = 'http://127.0.0.1:8090/health'
    SimnetProbeUrl = 'https://admin.simnet.kiev.ua/js/jquery.min.js'
    PbxProbeUrl = 'https://pbx.simnet.kiev.ua/'

    SingBoxConfig = Join-Path $env:LOCALAPPDATA 'sing-box-simnet\client.json'
    SingBoxTunName = 'simnet-uot'

    # In HOME/Vast mode this legacy local WireGuard tunnel conflicts with the
    # sing-box -> Vast route. START stops only this exact service and remembers
    # whether it must be restored by STOP.
    WireGuardService = 'WireGuardTunnel$Zyatyev_Andriy-HOME'
    StopConflictingWireGuard = $true

    # Dedicated Chrome profile guarantees PAC flags are applied without killing
    # or reusing unrelated personal Chrome windows.
    ChromeUserDataDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\ChromeProfile'

    RuntimeDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime'
    StateFile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\home-state.json'

    StartTimeoutSeconds = 15
}
