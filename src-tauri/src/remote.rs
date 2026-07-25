// remote projects: paths shaped "ssh://user@host:port/abs/path" run over the OpenSSH client
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const SCHEME: &str = "ssh://";
const RUN_TIMEOUT_SECS: u64 = 180;
const CONNECT_TIMEOUT_SECS: u64 = 30;

pub struct CmdOutput {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

impl CmdOutput {
    pub fn err_text(&self) -> String {
        let stderr = self.stderr.trim();
        if stderr.is_empty() {
            self.stdout.trim().to_string()
        } else {
            stderr.to_string()
        }
    }
}

// --- saved remote credentials, keyed by authority ("user@host" / "user@host:2222") ---

#[derive(Debug, Clone, Default)]
pub struct RemoteInfo {
    pub key_path: Option<String>,
}

fn registry() -> &'static Mutex<HashMap<String, RemoteInfo>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, RemoteInfo>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn set_remotes(entries: Vec<(String, RemoteInfo)>) {
    let mut reg = match registry().lock() {
        Ok(reg) => reg,
        Err(poisoned) => poisoned.into_inner(),
    };
    reg.clear();
    for (authority, info) in entries {
        reg.insert(authority, info);
    }
}

fn lookup(authority: &str) -> RemoteInfo {
    match registry().lock() {
        Ok(reg) => reg.get(authority).cloned().unwrap_or_default(),
        Err(poisoned) => poisoned
            .into_inner()
            .get(authority)
            .cloned()
            .unwrap_or_default(),
    }
}

// --- target parsing ---

#[derive(Debug, Clone)]
pub struct SshTarget {
    pub authority: String,
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
    pub key_path: Option<String>,
    /// The path lives on a windows filesystem, so sessions run under cmd.exe.
    pub windows: bool,
}

impl SshTarget {
    pub fn user_host(&self) -> String {
        match &self.user {
            Some(user) => format!("{}@{}", user, self.host),
            None => self.host.clone(),
        }
    }

    /// Rebuilds a url for another absolute path on the same host.
    pub fn url_for(&self, path: &str) -> String {
        let separator = if path.starts_with('/') { "" } else { "/" };
        format!("{}{}{}{}", SCHEME, self.authority, separator, path)
    }
}

pub enum Location {
    Local(String),
    Remote(SshTarget),
}

pub fn is_remote(path: &str) -> bool {
    path.starts_with(SCHEME)
}

/// True for a windows-style path like "C:/Projects/app".
pub fn is_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// Splits "ssh://user@host:22/abs/path" into ("user@host:22", "/abs/path").
/// Windows paths keep their drive letter: "ssh://host/C:/app" yields "C:/app".
pub fn split_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix(SCHEME)?;
    let (authority, path) = match rest.find('/') {
        Some(slash) => (rest[..slash].to_string(), rest[slash..].to_string()),
        None => (rest.to_string(), "/".to_string()),
    };
    let path = match path.strip_prefix('/') {
        Some(stripped) if is_windows_path(stripped) => stripped.to_string(),
        _ => path,
    };
    Some((authority, path))
}

pub fn target_from_url(url: &str) -> Result<SshTarget, String> {
    let (authority, path) = split_url(url).ok_or_else(|| format!("Not a remote path: {}", url))?;
    let info = lookup(&authority);

    let (user, host_port) = match authority.split_once('@') {
        Some((user, rest)) => (Some(user.to_string()), rest.to_string()),
        None => (None, authority.clone()),
    };
    let (host, port) = match host_port.split_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>().ok()),
        None => (host_port, None),
    };
    if host.is_empty() {
        return Err(format!("Remote path has no host: {}", url));
    }

    Ok(SshTarget {
        windows: is_windows_path(&path),
        authority,
        user,
        host,
        port,
        path,
        key_path: info.key_path,
    })
}

/// Builds a target from explicit connection details, for hosts with no project url yet.
pub fn make_target(
    user: Option<String>,
    host: String,
    port: Option<u16>,
    key_path: Option<String>,
    path: String,
) -> SshTarget {
    let mut authority = String::new();
    if let Some(user) = &user {
        authority.push_str(user);
        authority.push('@');
    }
    authority.push_str(&host);
    if let Some(port) = port.filter(|p| *p != 22) {
        authority.push(':');
        authority.push_str(&port.to_string());
    }
    SshTarget {
        windows: is_windows_path(&path),
        authority,
        user,
        host,
        port,
        path,
        key_path,
    }
}

pub fn locate(path: &str) -> Location {
    if is_remote(path) {
        match target_from_url(path) {
            Ok(target) => Location::Remote(target),
            Err(_) => Location::Local(path.to_string()),
        }
    } else {
        Location::Local(path.to_string())
    }
}

/// Joins a project path (local or remote url) with a relative path.
pub fn join_path(base: &str, rel: &str) -> String {
    let base = base.trim_end_matches('/');
    if is_remote(base) {
        format!("{}/{}", base, rel)
    } else {
        std::path::Path::new(base)
            .join(rel)
            .to_string_lossy()
            .to_string()
    }
}

// --- shell helpers ---

/// POSIX single-quote quoting for a remote shell argument.
pub fn q(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn shell_cmd(program: &str, args: &[&str]) -> String {
    let mut out = program.to_string();
    for arg in args {
        out.push(' ');
        out.push_str(&q(arg));
    }
    out
}

/// Resolves a `cd` prefix, expanding a leading `~`.
pub fn cd_to(path: &str) -> String {
    if path.is_empty() || path == "~" {
        "cd -- \"$HOME\"".to_string()
    } else if let Some(rest) = path.strip_prefix("~/") {
        format!("cd -- \"$HOME\"/{}", q(rest))
    } else {
        format!("cd -- {}", q(path))
    }
}

pub fn find_ssh_exe() -> Result<String, String> {
    static CACHED: OnceLock<Option<String>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            // prefer the Win32 client — it maps console resizes onto the remote pty,
            // which the msys build shipped with Git does not
            let win32 = r"C:\Windows\System32\OpenSSH\ssh.exe";
            if std::path::Path::new(win32).exists() {
                return Some(win32.to_string());
            }

            let mut cmd = Command::new("cmd.exe");
            cmd.args(["/c", "where", "ssh"])
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
            }
            None
        })
        .clone()
        .ok_or_else(|| "Could not find ssh.exe. Install the Windows OpenSSH client.".to_string())
}

pub fn ssh_args(target: &SshTarget, tty: bool) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ServerAliveInterval=30".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "LogLevel=ERROR".into(),
    ];
    if tty {
        args.push("-t".into());
    } else {
        // no prompts on the command channel — a hung password prompt would wedge every request
        args.push("-o".into());
        args.push("BatchMode=yes".into());
        args.push("-T".into());
    }
    if let Some(port) = target.port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    if let Some(key) = &target.key_path {
        args.push("-i".into());
        args.push(key.clone());
        args.push("-o".into());
        args.push("IdentitiesOnly=yes".into());
    }
    args.push(target.user_host());
    args
}

fn is_windows_shell(command: &str) -> bool {
    let head = command.split_whitespace().next().unwrap_or("").to_lowercase();
    matches!(
        head.as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe" | "cmd" | "cmd.exe"
    )
}

/// The single argument handed to ssh for an interactive session.
///
/// Windows hosts hand the command to cmd.exe, which is also what a local session runs
/// under, so the CLI behaves the same either way. Unix hosts get a login shell so PATH
/// setups living in a profile (nvm and friends) are picked up.
pub fn login_script(target: &SshTarget, command: &str) -> String {
    if target.windows {
        format!("cd /d \"{}\" && {}", target.path.replace('/', "\\"), command)
    } else if is_windows_shell(command) {
        format!("{} && exec bash -l", cd_to(&target.path))
    } else {
        format!("{} && exec bash -lc {}", cd_to(&target.path), q(command))
    }
}

// --- local execution ---

pub fn run_local(cwd: &str, program: &str, args: &[&str]) -> Result<CmdOutput, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(cwd);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run {}: {}", program, e))?;
    Ok(CmdOutput {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

// --- persistent command channel ---
//
// One long-lived `ssh host bash -l` per authority. Windows OpenSSH has no connection
// multiplexing, so reconnecting per command would cost a full handshake every time.
// Commands are framed by markers carrying the exit code.

/// How the command channel's shell is started. A windows host has no bash on PATH by
/// default, so the git-for-windows one is tried by full path.
const SHELL_LAUNCHERS: &[&str] = &[
    "bash -l",
    r#""C:\Program Files\Git\bin\bash.exe" -l"#,
    r#""C:\Program Files (x86)\Git\bin\bash.exe" -l"#,
];

struct Conn {
    child: Child,
    stdin: ChildStdin,
    stdout: Receiver<Vec<u8>>,
    stderr: Receiver<Vec<u8>>,
    token: String,
    /// The shell sees a windows filesystem (msys/cygwin), so `C:/...` paths resolve.
    msys: bool,
}

/// True when the ssh server hands commands to cmd.exe, which only a windows host does.
/// Cached per host: it decides the session dialect and which shells are usable.
fn host_is_windows(target: &SshTarget) -> bool {
    static CACHED: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = CACHED.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache.lock() {
        if let Some(known) = cache.get(&target.authority) {
            return *known;
        }
    }

    // cmd.exe expands %COMSPEC%, every posix shell passes it through untouched
    let probe = || -> Option<bool> {
        let mut cmd = Command::new(find_ssh_exe().ok()?);
        cmd.args(ssh_args(target, false));
        cmd.arg("echo %COMSPEC%");
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output().ok()?;
        Some(
            String::from_utf8_lossy(&output.stdout)
                .to_lowercase()
                .contains("cmd.exe"),
        )
    };
    let is_windows = probe().unwrap_or(false);

    if let Ok(mut cache) = cache.lock() {
        cache.insert(target.authority.clone(), is_windows);
    }
    is_windows
}

fn path_is_unset(path: &str) -> bool {
    path.is_empty() || path == "~"
}

/// Reads `uname -s` off the tail of the probe output, since a login profile may have
/// printed a banner ahead of it.
fn is_msys_uname(stdout: &str) -> bool {
    let kind = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_uppercase();
    kind.starts_with("MINGW") || kind.starts_with("MSYS") || kind.starts_with("CYGWIN")
}

impl Conn {
    fn open(target: &SshTarget) -> Result<Conn, String> {
        // a windows host needs a windows-hosted shell: wsl's bash would connect fine and
        // then resolve every path against the wrong filesystem. the path says which we
        // are on, except while browsing before a path is picked.
        let needs_msys =
            target.windows || (path_is_unset(&target.path) && host_is_windows(target));

        let mut last_err = "no shell found".to_string();
        for launcher in SHELL_LAUNCHERS {
            match Conn::open_with(target, launcher) {
                Ok(conn) if needs_msys && !conn.msys => {
                    last_err = format!("`{}` on {} is not a windows shell", launcher, target.host);
                }
                Ok(conn) => return Ok(conn),
                Err(err) => last_err = err,
            }
        }
        Err(format!(
            "ssh to {} failed: {}{}",
            target.user_host(),
            last_err,
            if needs_msys {
                " (remote projects on windows need Git for Windows installed)"
            } else {
                ""
            }
        ))
    }

    fn open_with(target: &SshTarget, launcher: &str) -> Result<Conn, String> {
        let ssh = find_ssh_exe()?;
        let mut cmd = Command::new(ssh);
        cmd.args(ssh_args(target, false));
        cmd.arg(launcher);
        Conn::spawn(cmd)
    }

    fn spawn(mut cmd: Command) -> Result<Conn, String> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start ssh: {}", e))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open ssh stdin".to_string())?;
        let stdout = pipe_reader(child.stdout.take());
        let stderr = pipe_reader(child.stderr.take());

        let mut conn = Conn {
            child,
            stdin,
            stdout,
            stderr,
            token: uuid::Uuid::new_v4().simple().to_string(),
            msys: false,
        };

        // first command doubles as the connect probe and swallows any login banner
        let probe = conn
            .exec("uname -s", CONNECT_TIMEOUT_SECS)
            .map_err(|e| e.message().to_string())?;
        if !probe.ok {
            return Err(probe.err_text());
        }
        conn.msys = is_msys_uname(&probe.stdout);
        Ok(conn)
    }

    fn exec(&mut self, script: &str, timeout_secs: u64) -> Result<CmdOutput, ExecError> {
        let out_mark = format!("__CCO{}", self.token);
        let err_mark = format!("__CCE{}", self.token);
        // subshell so a stray `exit` can't kill the channel, and no command can eat the
        // bytes of the next one off stdin
        let framed = format!(
            "( {} ) < /dev/null\n__cc_status=$?\nprintf '\\n{}%d\\n' \"$__cc_status\"\nprintf '\\n{}\\n' 1>&2\n",
            script, out_mark, err_mark
        );
        self.stdin
            .write_all(framed.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|e| ExecError::Dead(format!("connection lost: {}", e)))?;

        let deadline = Instant::now() + Duration::from_secs(timeout_secs);
        let (stdout, code) = read_until(&self.stdout, &out_mark, true, deadline)
            .map_err(|e| self.describe_failure(e))?;
        let (stderr, _) = read_until(&self.stderr, &err_mark, false, deadline)
            .map_err(|e| self.describe_failure(e))?;

        Ok(CmdOutput {
            ok: code == 0,
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        })
    }

    /// When the channel dies mid-command, ssh's own stderr says why.
    fn describe_failure(&self, err: ExecError) -> ExecError {
        let mut detail = String::new();
        while let Ok(chunk) = self.stderr.try_recv() {
            detail.push_str(&String::from_utf8_lossy(&chunk));
        }
        let detail = detail.trim();
        if detail.is_empty() {
            err
        } else {
            err.with_detail(detail)
        }
    }
}

#[derive(Debug)]
enum ExecError {
    /// The channel is gone — safe to reconnect and run the command again.
    Dead(String),
    /// The command may still be running remotely, so it must not be retried.
    Timeout(String),
}

impl ExecError {
    fn message(&self) -> &str {
        match self {
            ExecError::Dead(msg) | ExecError::Timeout(msg) => msg,
        }
    }

    fn with_detail(self, detail: &str) -> ExecError {
        match self {
            ExecError::Dead(msg) => ExecError::Dead(format!("{} ({})", msg, detail)),
            ExecError::Timeout(msg) => ExecError::Timeout(format!("{} ({})", msg, detail)),
        }
    }
}

impl Drop for Conn {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn pipe_reader<R: Read + Send + 'static>(source: Option<R>) -> Receiver<Vec<u8>> {
    let (tx, rx) = channel();
    if let Some(mut source) = source {
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match source.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    rx
}

/// Drains a pipe until the frame marker, returning everything before it (plus the exit code).
fn read_until(
    rx: &Receiver<Vec<u8>>,
    marker: &str,
    with_code: bool,
    deadline: Instant,
) -> Result<(Vec<u8>, i32), ExecError> {
    let needle = marker.as_bytes();
    let mut buf: Vec<u8> = Vec::new();
    let mut searched = 0usize;

    loop {
        if let Some(at) = find(&buf[searched..], needle).map(|i| i + searched) {
            let after = at + needle.len();
            let code = if with_code {
                match buf[after..].iter().position(|b| *b == b'\n') {
                    Some(end) => String::from_utf8_lossy(&buf[after..after + end])
                        .trim()
                        .parse::<i32>()
                        .unwrap_or(-1),
                    None => {
                        // exit code line not fully arrived yet
                        searched = at;
                        recv_more(rx, &mut buf, deadline)?;
                        continue;
                    }
                }
            } else {
                0
            };
            let mut out = buf;
            out.truncate(at);
            // drop the newline we injected ahead of the marker
            if out.last() == Some(&b'\n') {
                out.pop();
            }
            return Ok((out, code));
        }

        searched = buf.len().saturating_sub(needle.len());
        recv_more(rx, &mut buf, deadline)?;
    }
}

fn recv_more(
    rx: &Receiver<Vec<u8>>,
    buf: &mut Vec<u8>,
    deadline: Instant,
) -> Result<(), ExecError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(ExecError::Timeout("remote command timed out".to_string()));
    }
    match rx.recv_timeout(remaining) {
        Ok(chunk) => {
            buf.extend_from_slice(&chunk);
            Ok(())
        }
        Err(RecvTimeoutError::Timeout) => {
            Err(ExecError::Timeout("remote command timed out".to_string()))
        }
        Err(RecvTimeoutError::Disconnected) => {
            Err(ExecError::Dead("connection closed".to_string()))
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

type Slot = Arc<Mutex<Option<Conn>>>;

fn pool() -> &'static Mutex<HashMap<String, Slot>> {
    static POOL: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn slot_for(authority: &str) -> Slot {
    let mut pool = match pool().lock() {
        Ok(pool) => pool,
        Err(poisoned) => poisoned.into_inner(),
    };
    pool.entry(authority.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(None)))
        .clone()
}

pub fn shutdown() {
    let slots: Vec<Slot> = match pool().lock() {
        Ok(mut pool) => pool.drain().map(|(_, slot)| slot).collect(),
        Err(poisoned) => poisoned.into_inner().drain().map(|(_, s)| s).collect(),
    };
    // a slot busy with an in-flight command is left alone — its ssh exits on its own
    // once our end of the pipe closes, and waiting here would stall app exit
    for slot in slots {
        if let Ok(mut guard) = slot.try_lock() {
            *guard = None;
        }
    }
}

/// Runs a shell command on the remote host, optionally after cd'ing somewhere.
pub fn run(target: &SshTarget, cwd: Option<&str>, command: &str) -> Result<CmdOutput, String> {
    let script = match cwd {
        Some(dir) => format!("{{ {} && {}; }}", cd_to(dir), command),
        None => command.to_string(),
    };

    let slot = slot_for(&target.authority);
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let mut last_err = "no connection".to_string();
    for attempt in 0..2 {
        if guard.is_none() {
            *guard = Some(Conn::open(target)?);
        }
        let Some(conn) = guard.as_mut() else {
            break;
        };
        match conn.exec(&script, RUN_TIMEOUT_SECS) {
            Ok(output) => return Ok(output),
            Err(err) => {
                // either way the channel is unusable: a timed-out command leaves its
                // output stranded in the pipe, which would desync the next one
                last_err = err.message().to_string();
                let retryable = matches!(err, ExecError::Dead(_));
                *guard = None;
                if !retryable || attempt == 1 {
                    break;
                }
            }
        }
    }
    Err(last_err)
}

/// Runs and fails if the command did.
pub fn run_checked(target: &SshTarget, cwd: Option<&str>, command: &str) -> Result<String, String> {
    let output = run(target, cwd, command)?;
    if output.ok {
        Ok(output.stdout)
    } else {
        Err(output.err_text())
    }
}

// --- remote file access ---

pub fn read_text(target: &SshTarget, path: &str) -> Result<String, String> {
    let output = run(target, None, &format!("cat -- {}", q(path)))?;
    if output.ok {
        Ok(output.stdout)
    } else {
        Err(format!("Failed to read {}: {}", path, output.err_text()))
    }
}

pub fn write_text(target: &SshTarget, path: &str, content: &str) -> Result<(), String> {
    // base64 keeps binary-exact bytes through the shell — no heredoc newline surprises
    let encoded = base64_encode(content.as_bytes());
    let command = format!(
        "printf %s {} | base64 -d > {}",
        q(&encoded),
        q(path)
    );
    let output = run(target, None, &command)?;
    if output.ok {
        Ok(())
    } else {
        Err(format!("Failed to write {}: {}", path, output.err_text()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drives the framing protocol against a local login bash — same plumbing as a real
    /// channel (including profile noise the probe has to swallow), no network.
    fn local_conn() -> Option<Conn> {
        let mut cmd = Command::new("bash");
        cmd.arg("-l");
        Conn::spawn(cmd).ok()
    }

    #[test]
    fn frames_stdout_stderr_and_exit_code() {
        let Some(mut conn) = local_conn() else { return };

        let out = conn.exec("printf 'hello\\n'", 30).unwrap();
        assert!(out.ok);
        assert_eq!(out.stdout, "hello\n");
        assert_eq!(out.stderr, "");

        let out = conn.exec("printf 'oops\\n' 1>&2; exit 3", 30).unwrap();
        assert!(!out.ok);
        assert_eq!(out.stderr, "oops\n");

        // output without a trailing newline stays that way
        let out = conn.exec("printf 'no-newline'", 30).unwrap();
        assert_eq!(out.stdout, "no-newline");

        // crlf content survives round-tripping
        let out = conn.exec("printf 'a\\r\\nb\\r\\n'", 30).unwrap();
        assert_eq!(out.stdout, "a\r\nb\r\n");

        // a chunk larger than the read buffer arrives whole
        let out = conn.exec("head -c 40000 /dev/zero | tr '\\0' 'x'", 30).unwrap();
        assert_eq!(out.stdout.len(), 40000);
    }

    #[test]
    fn quotes_arguments_for_the_remote_shell() {
        assert_eq!(q("plain"), "'plain'");
        assert_eq!(q("with space"), "'with space'");
        assert_eq!(q("it's"), "'it'\\''s'");
        assert_eq!(shell_cmd("git", &["commit", "-m", "a'b"]), "git 'commit' '-m' 'a'\\''b'");
    }

    #[test]
    fn round_trips_quoted_args_through_bash() {
        let Some(mut conn) = local_conn() else { return };
        let tricky = "a'b \"c\" $d `e` \\f";
        let out = conn
            .exec(&format!("printf '%s' {}", q(tricky)), 30)
            .unwrap();
        assert_eq!(out.stdout, tricky);
    }

    #[test]
    fn parses_remote_urls() {
        let (authority, path) = split_url("ssh://me@box:2222/srv/app").unwrap();
        assert_eq!(authority, "me@box:2222");
        assert_eq!(path, "/srv/app");

        let (authority, path) = split_url("ssh://box").unwrap();
        assert_eq!(authority, "box");
        assert_eq!(path, "/");

        let target = target_from_url("ssh://me@box:2222/srv/app").unwrap();
        assert_eq!(target.user.as_deref(), Some("me"));
        assert_eq!(target.host, "box");
        assert_eq!(target.port, Some(2222));
        assert_eq!(target.user_host(), "me@box");

        let target = target_from_url("ssh://box/srv").unwrap();
        assert_eq!(target.user, None);
        assert_eq!(target.port, None);
        assert!(!is_remote("C:\\Projects\\app"));
    }

    #[test]
    fn authority_omits_the_default_port() {
        let target = make_target(
            Some("me".into()),
            "box".into(),
            Some(22),
            None,
            "/srv".into(),
        );
        assert_eq!(target.authority, "me@box");
        assert_eq!(target.url_for("/srv/app"), "ssh://me@box/srv/app");

        let target = make_target(None, "box".into(), Some(2222), None, "/srv".into());
        assert_eq!(target.authority, "box:2222");
    }

    #[test]
    fn joins_paths_per_location() {
        assert_eq!(
            join_path("ssh://box/srv/app/", "src/main.rs"),
            "ssh://box/srv/app/src/main.rs"
        );
        assert!(join_path("C:\\app", "src").ends_with("src"));
    }

    #[test]
    fn expands_home_in_cd() {
        assert_eq!(cd_to(""), "cd -- \"$HOME\"");
        assert_eq!(cd_to("~/app"), "cd -- \"$HOME\"/'app'");
        assert_eq!(cd_to("/srv/app"), "cd -- '/srv/app'");
    }

    #[test]
    fn wraps_interactive_commands_in_a_login_shell() {
        let unix = make_target(None, "box".into(), None, None, "/srv/app".into());
        assert_eq!(
            login_script(&unix, "claude --resume abc"),
            "cd -- '/srv/app' && exec bash -lc 'claude --resume abc'"
        );
        // a windows shell has no meaning on a unix host, so fall back to the login shell
        assert_eq!(
            login_script(&unix, "powershell"),
            "cd -- '/srv/app' && exec bash -l"
        );
    }

    #[test]
    fn runs_windows_sessions_under_cmd() {
        let windows = make_target(None, "box".into(), None, None, "C:/Projects/app".into());
        assert!(windows.windows);
        assert_eq!(
            login_script(&windows, "claude --session-id abc"),
            "cd /d \"C:\\Projects\\app\" && claude --session-id abc"
        );
        // powershell is a real shell there, so it is spawned as asked
        assert_eq!(
            login_script(&windows, "powershell"),
            "cd /d \"C:\\Projects\\app\" && powershell"
        );
    }

    #[test]
    fn round_trips_windows_paths_through_urls() {
        let target = target_from_url("ssh://circu@10.0.0.5/C:/Projects/app").unwrap();
        assert!(target.windows);
        assert_eq!(target.path, "C:/Projects/app");
        assert_eq!(
            target.url_for("C:/Projects/app/src/main.rs"),
            "ssh://circu@10.0.0.5/C:/Projects/app/src/main.rs"
        );

        // unix paths keep their leading slash and stay unix
        let target = target_from_url("ssh://box/srv/app").unwrap();
        assert!(!target.windows);
        assert_eq!(target.path, "/srv/app");
        assert_eq!(target.url_for("/srv/app/x"), "ssh://box/srv/app/x");
    }

    #[test]
    fn cds_into_windows_paths_from_msys_bash() {
        assert_eq!(cd_to("C:/Projects/app"), "cd -- 'C:/Projects/app'");
    }

    #[test]
    fn detects_msys_behind_a_login_banner() {
        assert!(is_msys_uname("MINGW64_NT-10.0-26200\n"));
        assert!(is_msys_uname("Welcome to the box!\nMSYS_NT-10.0\n"));
        assert!(!is_msys_uname("Welcome to the box!\nLinux\n"));
        assert!(!is_msys_uname(""));
        // a banner mentioning mingw must not be mistaken for the answer
        assert!(!is_msys_uname("mingw notes of the day\nLinux\n"));
    }

    #[test]
    fn encodes_base64() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"hello world\n"), "aGVsbG8gd29ybGQK");
    }

    #[test]
    fn writes_content_verbatim_through_base64() {
        let Some(mut conn) = local_conn() else { return };
        let content = "line1\r\nline2\nno trailing newline's \"quotes\"";
        let out = conn
            .exec(
                &format!("printf %s {} | base64 -d", q(&base64_encode(content.as_bytes()))),
                30,
            )
            .unwrap();
        assert_eq!(out.stdout, content);
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}
