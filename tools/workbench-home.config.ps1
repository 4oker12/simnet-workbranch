# SIMNET Workbench runtime configuration.
# The same Vast endpoint is used by HOME and WORK launchers.

$WorkbenchHomeConfig = [ordered]@{
    VastHost = '91.150.160.38'
    VastSshPort = 16988
    VastUser = 'root'

    LocalSocksPort = 25344
    RemoteSocksHost = '127.0.0.1'
    RemoteSocksPort = 25344

    # Private Shadowsocks bridge for the optional local SIP/TUN path. It is
    # carried only inside the SSH session; no public Vast port is required.
    LocalShadowsocksPort = 10200
    RemoteShadowsocksHost = '127.0.0.1'
    RemoteShadowsocksPort = 10200

    LocalAsrPort = 8090
    RemoteAsrHost = '127.0.0.1'
    RemoteAsrPort = 8000

    # HOME browser routing uses the proven local PAC file directly. No local
    # HTTP server is required for Chrome. PacPort/PacDirectory are retained only
    # for backward-compatible STOP/state handling from older runs.
    PacPath = Join-Path $env:USERPROFILE 'simnet-vast.pac'
    PacPort = 8765
    PacDirectory = $env:USERPROFILE

    AsrHealthUrl = 'http://127.0.0.1:8090/health'
    # PBX is the decisive HOME/WORK probe: at HOME Billing/UserSide may still be
    # reachable directly, while PBX requires the Vast/SOCKS route.
    SimnetProbeUrl = 'https://pbx.simnet.kiev.ua/'
    PbxProbeUrl = 'https://pbx.simnet.kiev.ua/'
    UsersideUrl = 'https://userside.simnet.kiev.ua/'
    BillingUrl = 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl'
    GroqProbeUrl = 'https://api.groq.com/openai/v1/models'

    # Original local client config remains the private source of the Shadowsocks
    # method/password. START writes a runtime copy pointed at localhost:10200
    # only when attempting the optional SIP/TUN layer.
    SingBoxConfig = Join-Path $env:LOCALAPPDATA 'sing-box-simnet\client.json'
    RuntimeSingBoxClientConfig = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\client-home-runtime.json'
    SingBoxTunName = 'simnet-uot'

    # Private HOME transport state is intentionally stored outside the Git repo.
    # server-unified.json can be regenerated from wireguard-home.conf plus the
    # existing local sing-box client config; neither secret is committed.
    PrivateDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\private'
    PrivateWireGuardConfig = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\private\wireguard-home.conf'
    PrivateSingBoxServerConfig = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\private\server-unified.json'

    # HOME/Vast invariant: this legacy local WireGuard service must stay OFF.
    # START only stops this exact service; STOP never turns it back on.
    WireGuardService = 'WireGuardTunnel$Zyatyev_Andriy-HOME'
    StopConflictingWireGuard = $true

    # Reuse the previously proven dedicated HOME Chrome profile so cookies and
    # logins survive between one-click starts.
    ChromeUserDataDir = Join-Path $env:USERPROFILE 'SIMNET-Chrome-Home'

    RuntimeDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime'
    StateFile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\home-state.json'
    UnifiedStateFile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime\workbench-state.json'

    StartTimeoutSeconds = 20
}
