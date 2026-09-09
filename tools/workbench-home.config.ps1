# SIMNET Workbench runtime configuration.
# The same Vast endpoint is used by HOME and WORK launchers.

$WorkbenchHomeConfig = [ordered]@{
    VastHost = '91.150.160.38'
    VastSshPort = 11674
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
    # PBX is the decisive HOME/WORK probe: at HOME Billing/UserSide may still be
    # reachable directly, while PBX requires the Vast/SOCKS route.
    SimnetProbeUrl = 'https://pbx.simnet.kiev.ua/'
    PbxProbeUrl = 'https://pbx.simnet.kiev.ua/'
    GroqProbeUrl = 'https://api.groq.com/openai/v1/models'

    SingBoxConfig = Join-Path $env:LOCALAPPDATA 'sing-box-simnet\client.json'
    SingBoxTunName = 'simnet-uot'

    # Private HOME transport state is intentionally stored outside the Git repo.
    # It can be copied to a fresh Vast instance without ever committing secrets.
    PrivateDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\private'
    PrivateSingBoxServerConfig = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\private\server-unified.json'

    # HOME/Vast invariant: this legacy local WireGuard service must stay OFF.
    # START only stops this exact service; STOP never turns it back on.
    WireGuardService = 'WireGuardTunnel$Zyatyev_Andriy-HOME'
    StopConflictingWireGuard = $true

    ChromeUserDataDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\ChromeProfile'

    RuntimeDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime'
    StateFile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\home-state.json'
    UnifiedStateFile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\workbench-state.json'

    StartTimeoutSeconds = 20
}
