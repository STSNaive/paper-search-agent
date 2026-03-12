# Skills

This directory contains skill definitions for `paper-search-agent`.

Skills follow the [Agent Skills](https://agentskills.io/) open standard and are shared between Codex and Claude Code backends. Each subdirectory contains a `SKILL.md` with domain-specific knowledge.

The root agent reads a skill's `SKILL.md` on demand when entering the relevant workflow phase. Skills are reference material, not execution entities.

## Skills

| Skill | Purpose |
|---|---|
| `topic-scoping` | Structures research questions into actionable search plans |
| `access-routing` | Maps papers to retrieval routes based on publisher and entitlement |
| `fulltext-ingestion` | Normalizes XML, HTML, PDF, and plain text into structured records |
