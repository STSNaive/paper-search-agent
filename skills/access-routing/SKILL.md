---
name: access-routing
description: >
  Determines whether a paper should use OA, a publisher API, browser retrieval,
  or manual import. Contains publisher identification rules, entitlement preflight
  logic, route fallback order, and configuration switch awareness.
  Use this skill when you have a CandidatePaper and need to create an AccessPlan.
---

# access-routing

## When to Use

- You have a `CandidatePaper` or DOI and need to decide how to get full text.
- You need to check publisher identity, OA status, and entitlement conditions.
- You need to plan fallback routes when the preferred route may fail.

## DOI → Publisher Mapping

| DOI Prefix | Publisher | Typical Route |
|---|---|---|
| `10.1016` | Elsevier | `elsevier_api_fulltext` (campus IP + API key) |
| `10.1006`, `10.1053`, `10.1067` | Elsevier (legacy) | `elsevier_api_fulltext` |
| `10.1007` | Springer Nature | `springer_oa_api` (OA) or `browser_download_pdf` (subscription) |
| `10.1038` | Nature | same as Springer Nature |
| `10.1002` | Wiley | `wiley_tdm_download` or `browser_download_pdf` |
| `10.1109` | IEEE | `browser_download_pdf` |
| `10.1145` | ACM | `browser_download_pdf` |
| `10.1371` | PLOS | `oa_openalex` (always OA) |
| `10.3389` | Frontiers | `oa_openalex` (always OA) |
| `10.48550` | arXiv | `oa_openalex` |

For DOIs not in this table, use Crossref metadata to infer the publisher.

## Route Priority Order

1. **Local cache** — already stored?
2. **Zotero** — already in library with PDF? (if enabled)
3. **OA** — OpenAlex `best_oa_location`, Unpaywall, Europe PMC free full text, publisher OA
4. **Publisher API** — Elsevier (campus-entitled), Springer OA API, Wiley TDM
5. **Browser** — human-in-the-loop for subscription content
6. **Manual import** — user provides file

## Entitlement Preflight Rules

### Elsevier
- **Required**: `ELSEVIER_API_KEY` configured AND campus-network IP recognized
- **Check**: HEAD request to Article Retrieval API; 200 = entitled, 403 = not entitled
- **If not entitled**: skip API route, try browser or manual

### Springer
- **OA content**: OpenAccess API returns JATS XML. Check with API first.
- **Subscription content**: **No API exists.** Must use browser on campus network.
- **Key rule**: never attempt `springer_fulltext_api` for non-OA content.

### Wiley
- **Required**: `WILEY_TDM_TOKEN` configured AND institutional subscription active
- **Check**: attempt download by DOI; 200 = success, 403 = no subscription
- **If no subscription**: fall back to browser, then manual import

### Europe PMC
- **Check**: search for DOI/PMID in Europe PMC; if `isOpenAccess=Y` and full-text XML available, route is ready
- **No credentials required**

### Browser
- **Ready when**: a browser session can open the landing page
- **Human interaction**: pause for CAPTCHA, login, cookie consent
- **State saving**: save cookies/sessions after successful verification

## Fallback and Downgrade Rules

- **Transient failure** (timeout, 5xx) → retry same route once
- **Authorization failure** (401, 403) → immediately try next route
- **Parser failure** → try alternate parser, then alternate artifact type
- **All routes exhausted** → recommend manual import with explanation

## Configuration Switch Awareness

Before attempting any route, check if the corresponding source is enabled in `config.toml`:

- `[discovery]` switches control which sources are queried
- `[retrieval]` switches control which retrieval routes are attempted
- `[integrations]` switches control optional features (Zotero)

A disabled route should never be attempted or suggested.
