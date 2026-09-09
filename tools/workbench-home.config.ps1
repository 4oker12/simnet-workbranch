# SIMNET Workbench HOME runtime configuration.
# Machine-specific values live here. These scripts never modify Vast itself.

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
    GroqProbeUrl = 'https://api.groq.com/openai/v1/models'

    SingBoxConfig = Join-Path $env:LOCALAPPDATA 'sing-box-simnet\client.json'
    SingBoxTunName = 'simnet-uot'

    # HOME/Vast invariant: this legacy local WireGuard service must stay OFF.
    # START only stops this exact service; STOP never turns it back on.
    WireGuardService = 'WireGuardTunnel$Zyatyev_Andriy-HOME'
    StopConflictingWireGuard = $true

    # Persistent dedicated Chrome profile: flags are deterministic and the
    # operator keeps sessions between launches without killing personal Chrome.
    ChromeUserDataDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\ChromeProfile'

    RuntimeDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime'
    StateFile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\home-state.json'

    StartTimeoutSeconds = 15
}
