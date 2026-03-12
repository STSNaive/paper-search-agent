# setup-claude.ps1 — Generate Claude Code compatibility files from Codex sources.
#
# This script:
# 1. Copies AGENTS.md → CLAUDE.md (root)
# 2. Generates .mcp.json for Claude Code MCP registration
# 3. Verifies skills are present (no conversion needed)
#
# Generated files are listed in .gitignore and should NOT be committed.

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "=== paper-search-agent: Claude Code compatibility setup ===" -ForegroundColor Cyan

# ── 1. Copy instruction files ──────────────────────────────────

Write-Host ""
Write-Host "Copying AGENTS.md → CLAUDE.md ..."

# Root
$rootAgents = Join-Path $ProjectRoot "AGENTS.md"
if (Test-Path $rootAgents) {
    Copy-Item $rootAgents (Join-Path $ProjectRoot "CLAUDE.md") -Force
    Write-Host "  ✓ CLAUDE.md (root)" -ForegroundColor Green
}

# ── 2. Generate .mcp.json ─────────────────────────────────────

Write-Host ""
Write-Host "Generating .mcp.json ..."

$mcpJson = @'
{
  "mcpServers": {
    "paper-search-agent": {
      "command": "node",
      "args": ["mcp/paper-search-agent-mcp/dist/server.js"],
      "cwd": "."
    }
  }
}
'@

$mcpJson | Set-Content -Path (Join-Path $ProjectRoot ".mcp.json") -Encoding UTF8
Write-Host "  ✓ .mcp.json" -ForegroundColor Green

# ── 3. Verify skills ──────────────────────────────────────────

Write-Host ""
Write-Host "Verifying skills ..."

$skillCount = 0
$skillDirs = Get-ChildItem -Path (Join-Path $ProjectRoot "skills") -Directory -ErrorAction SilentlyContinue
foreach ($dir in $skillDirs) {
    $skillFile = Join-Path $dir.FullName "SKILL.md"
    if (Test-Path $skillFile) {
        $skillCount++
        Write-Host "  ✓ $($dir.Name)/SKILL.md" -ForegroundColor Green
    }
}

Write-Host "  $skillCount skill(s) found — no conversion needed (Agent Skills standard)"

# ── Done ───────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Done. Claude Code is ready to use. ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Generated files (git-ignored):"
Write-Host "  - CLAUDE.md"
Write-Host "  - .mcp.json"
