param(
  [Parameter(Mandatory = $true)]
  [string]$SourceBranch,

  [Parameter(Mandatory = $true)]
  [string]$PrBranch,

  [string]$UpstreamBranch = "upstream-main",
  [string]$UpstreamRemote = "upstream",
  [string]$UpstreamRemoteBranch = "main",
  [switch]$SkipFetch,
  [switch]$ResetExisting,
  [switch]$NoValidate
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  git @args
  if ($LASTEXITCODE -ne 0) {
    throw "git $args failed with exit code $LASTEXITCODE"
  }
}

function Test-GitSuccess {
  git @args *> $null
  return $LASTEXITCODE -eq 0
}

function Assert-CleanWorktree {
  $status = git status --porcelain
  if ($status) {
    throw "Working tree is not clean. Commit, stash, or remove local changes before creating a PR branch."
  }
}

function Remove-LocalOverlay {
  param([string]$BaseBranch)

  $removePaths = @(
    ".agents",
    "AGENTS.md",
    "change_requests",
    "start_dev_client.bat",
    "start_dev_server.bat",
    "start_dev_server_logged.bat",
    "filter_server_log.bat",
    "filter_server_log.ps1"
  )

  foreach ($path in $removePaths) {
    Invoke-Git rm -r --ignore-unmatch --quiet -- $path
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }

  Invoke-Git restore --source $BaseBranch --staged --worktree -- .gitignore
}

function Has-StagedChanges {
  git diff --cached --quiet
  return $LASTEXITCODE -ne 0
}

Assert-CleanWorktree

if (-not (Test-GitSuccess rev-parse --verify "$SourceBranch^{commit}")) {
  throw "Source branch '$SourceBranch' does not exist."
}

if (-not (Test-GitSuccess rev-parse --verify "$UpstreamBranch^{commit}")) {
  throw "Upstream branch '$UpstreamBranch' does not exist."
}

if (-not $SkipFetch) {
  Invoke-Git fetch $UpstreamRemote "${UpstreamRemoteBranch}:refs/heads/$UpstreamBranch"
}

if (Test-GitSuccess rev-parse --verify "$PrBranch^{commit}") {
  if (-not $ResetExisting) {
    throw "PR branch '$PrBranch' already exists. Re-run with -ResetExisting to recreate it from '$UpstreamBranch'."
  }

  Invoke-Git switch $PrBranch
  Invoke-Git reset --hard $UpstreamBranch
} else {
  Invoke-Git switch --create $PrBranch $UpstreamBranch
}

$base = git merge-base $UpstreamBranch $SourceBranch
if ($LASTEXITCODE -ne 0 -or -not $base) {
  throw "Could not find merge base between '$UpstreamBranch' and '$SourceBranch'."
}

$commits = @(git rev-list --reverse "$base..$SourceBranch")
foreach ($commit in $commits) {
  Invoke-Git cherry-pick --no-commit $commit
  Remove-LocalOverlay -BaseBranch $UpstreamBranch

  if (Has-StagedChanges) {
    $subject = git log -1 --format=%s $commit
    Invoke-Git commit -m $subject
  }
}

Remove-LocalOverlay -BaseBranch $UpstreamBranch

if (Has-StagedChanges) {
  Invoke-Git commit -m "Remove local overlay artifacts"
}

Write-Host ""
Write-Host "Created upstream PR branch '$PrBranch' from '$SourceBranch'."
Write-Host ""
Write-Host "Diff against ${UpstreamBranch}:"
Invoke-Git diff --name-status "$UpstreamBranch..HEAD"

if (-not $NoValidate) {
  Write-Host ""
  Write-Host "Running pnpm check..."
  pnpm check
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm check failed with exit code $LASTEXITCODE"
  }
}
