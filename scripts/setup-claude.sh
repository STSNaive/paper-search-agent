#!/usr/bin/env bash
# setup-claude.sh — Generate Claude Code compatibility files from Codex sources.
#
# This script:
# 1. Copies AGENTS.md → CLAUDE.md (root)
# 2. Generates .mcp.json for Claude Code MCP registration
# 3. Verifies skills are present (no conversion needed)
#
# Generated files are listed in .gitignore and should NOT be committed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== paper-search-agent: Claude Code compatibility setup ==="

# ── 1. Copy instruction files ──────────────────────────────────

echo ""
echo "Copying AGENTS.md → CLAUDE.md ..."

# Root
if [ -f "$PROJECT_ROOT/AGENTS.md" ]; then
  cp "$PROJECT_ROOT/AGENTS.md" "$PROJECT_ROOT/CLAUDE.md"
  echo "  ✓ CLAUDE.md (root)"
fi

# ── 2. Generate .mcp.json ─────────────────────────────────────

echo ""
echo "Generating .mcp.json ..."

MCP_JSON="$PROJECT_ROOT/.mcp.json"
cat > "$MCP_JSON" << 'MCPEOF'
{
  "mcpServers": {
    "paper-search-agent": {
      "command": "node",
      "args": ["mcp/paper-search-agent-mcp/dist/server.js"],
      "cwd": "."
    }
  }
}
MCPEOF

echo "  ✓ .mcp.json"

# ── 3. Verify skills ──────────────────────────────────────────

echo ""
echo "Verifying skills ..."

SKILL_COUNT=0
for skill_file in "$PROJECT_ROOT"/skills/*/SKILL.md; do
  if [ -f "$skill_file" ]; then
    SKILL_COUNT=$((SKILL_COUNT + 1))
    echo "  ✓ $(basename "$(dirname "$skill_file")")/SKILL.md"
  fi
done

echo "  $SKILL_COUNT skill(s) found — no conversion needed (Agent Skills standard)"

# ── Done ───────────────────────────────────────────────────────

echo ""
echo "=== Done. Claude Code is ready to use. ==="
echo ""
echo "Generated files (git-ignored):"
echo "  - CLAUDE.md"
echo "  - .mcp.json"
