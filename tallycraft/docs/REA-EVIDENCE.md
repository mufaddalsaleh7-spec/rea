# Reconstruction evidence

This file records what the REA agents installed in this repository were used
for, what evidence the reconstruction of Tally Prime rests on, and — explicitly
— what could not be verified here. It follows the repository's rule that
observations, derivations, inferences and unknowns are kept apart.

## 1. Agent installation (observed)

| Step         | Command                                                         | Result                                             |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------- |
| Dependencies | `npm ci --no-audit --no-fund`                                   | 523 packages installed                             |
| Build        | `npm run build:cached`                                          | 3/3 turbo tasks, `dist/` plus packaged skill       |
| Plan         | `node scripts/rea.mjs setup --client <24 ids> --dry-run --json` | 33 planned actions, all inside `$HOME`             |
| Apply        | `node scripts/rea.mjs setup --client <24 ids> --yes --json`     | 24 client registrations + 9 skill destinations     |
| Verify       | `node scripts/rea.mjs doctor --json`                            | every registration `aligned`; skill v42, 207 tools |

Clients registered (all reported `aligned` by `doctor`):

```
antigravity, claude_code, claude_desktop, codex, commandcode, copilot_cli,
cursor, devin, droid, dsh, gemini_cli, grok_build, hermes, kimi, omp,
opencode, pi, qoder, qwen_code, trae, vscode, windsurf, workbuddy, zcode
```

Catalog identity reported by `doctor`:

```json
{"cli_commands": 153, "mcp_tools": 207, "mcp_prompts": 6}
{"installed_version": "42", "installed_tool_count": 207, "state": "aligned"}
```

Each registration runs `/home/user/rea/scripts/rea.mjs mcp` over stdio, e.g. in
`~/.codex/config.toml`:

```toml
[mcp_servers.rea]
command = "/home/user/rea/scripts/rea.mjs"
args = ["mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 450
```

`grok_bot` was deliberately skipped: its connectors live in the signed-in
account and setup does not write host configuration for it (`doctor` reports
the same, with the chat-step remediation). Installing a stdio server on this
machine would not attach it.

The installed skill (`reverse-engineer-anything`, version 42) supplies the
workflow rules used below: route by target, keep Evidence provenance, never
present an inference as an observation.

### Provider readiness (observed)

```
node            healthy   22.22.3
host            healthy   debian 12
hopper          missing   install Hopper or set HOPPER_LAUNCHER_PATH
ghidra          missing   GHIDRA_INSTALL_DIR is not set
ida             missing   REA_IDA_MCP_CONFIG is not set
jadx            missing   REA_JADX_MCP_JAR is not set
kuna            missing   REA_KUNA_COMMAND is not set
```

Native analysis providers are bring-your-own and were not installed: REA's
own rules forbid the installer from adding Ghidra, IDA, Java or Hopper as a
side effect, and no vendor engine was present on this host.

## 2. The target and the evidence boundary

Tally Prime is commercial, Windows-only desktop software. **No licensed
installation exists on this Linux host**, so:

- no executable, installer, DLL, or data file of Tally Prime was available to
  `open_binary`, `analyze`, `decompile`, or the artifact tools;
- no runtime observation (process capture, UI automation, network capture) of
  Tally Prime was possible;
- therefore **zero binary-level evidence** backs this reconstruction, and none
  is claimed.

What the reconstruction _does_ rest on is Tally's documented, publicly
specified surface — the interchange contract that Tally itself publishes for
integrators:

| Claim used in the build                                                                      | Basis                                                                                        | Status                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| 28 predefined groups and their parents                                                       | Tally's documented group set, also reproduced by community XML exports                       | derived                       |
| Natural balance direction per group (Dr/Cr)                                                  | Same documentation                                                                           | derived                       |
| Voucher types and function keys (F4 Contra … F9 Purchase, Alt+F5/F6 notes)                   | Tally's documented keyboard map                                                              | derived                       |
| Report names and their sections (Trial Balance, Balance Sheet, P&L, Day Book, Stock Summary) | Documentation and widely published screenshots                                               | derived                       |
| Tally XML envelope (`ENVELOPE → BODY → IMPORTDATA → REQUESTDATA → TALLYMESSAGE`)             | Tally's XML integration format                                                               | derived                       |
| Ledger entry sign convention: `ISDEEMEDPOSITIVE=Yes` with a negative `AMOUNT` = debit        | Appears in every published Tally voucher export                                              | observed in published exports |
| `Stock-in-Hand` is inventory-controlled and not posted to directly                           | Documented inventory behaviour, and consistent with Tally's refusal to select it in vouchers | inferred                      |
| Exact on-screen layout, colour, wording of Tally Prime                                       | Not measured; TallyCraft is _modelled on_, not pixel-copied from, Tally Prime                | unknown                       |

The application deliberately does not reproduce Tally's trade dress. It
reproduces the accounting model and the interchange format.

## 3. How REA shaped the work

- **Routing**: the skill's target-first rule maps Tally Prime (a packaged
  Windows application) to the native/packaged route, which needs a provider.
  With no provider and no target binary, the correct next move per the skill is
  not to fabricate analysis but to state the blocker and continue with the
  evidence that _is_ available — the interchange contract. That is what this
  build does, and Section 2 is that statement.
- **Evidence discipline**: every behavioural claim above is labelled
  observed / derived / inferred / unknown rather than asserted.
- **Reconstruction obligations**: the skill's rule of recording what a
  reconstruction depends on is applied literally in
  [DESIGN.md](DESIGN.md#known-limitations) — each unimplemented Tally capability
  is listed instead of being silently absent.
- **Verification instead of assertion**: because no external ground truth was
  available, correctness is pinned by self-consistency invariants that a wrong
  accounting model fails immediately (debits = credits, assets = liabilities,
  per-ledger opening + movements = closing, XML round-trip equality). See
  `../test/`.

## 4. What an operator should run with a real Tally Prime copy

On a Windows or macOS workstation with a licensed Tally Prime installation and a
REA-supported provider, these commands close the evidence gap. Run them before
trusting any behavioural claim about Tally itself.

```bash
# 1. Inventory the installed package and its payload
rea open_binary "C:/TallyPrime/tally.exe" --json
rea inspect-artifact "C:/TallyPrime" --json

# 2. Confirm which engine REA will actually use
GHIDRA_INSTALL_DIR=/opt/ghidra rea doctor --provider ghidra --json

# 3. Static native analysis: entry points, imports, embedded report names
rea analyze "C:/TallyPrime/tally.exe" --provider ghidra --json
rea function "C:/TallyPrime/tally.exe" --address <entry> --json

# 4. Observe the running product instead of guessing its UI
rea list-processes --json
rea capture-process --pid <tally-pid> --json

# 5. Ground the interchange contract in real output
#    File > Export > Data in Tally, then:
rea inspect-artifact ./export.xml --json
```

What each answers:

| Command                            | Question it settles                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `open_binary` / `inspect_artifact` | Which files exist, their format and digests (is the data layer a proprietary `.900`/`.tsf` store?)                  |
| `analyze` + `function`             | Which code paths implement voucher validation and report aggregation                                                |
| `capture-process`                  | Actual shortcuts, window titles, report labels                                                                      |
| Real XML export                    | Whether the sign convention, group masters and voucher schema used here match a licensed installation byte for byte |

Until those run, treat TallyCraft's fidelity claims as **interface-level**, not
implementation-level.

## 5. Reproducing this environment

```bash
cd ..
npm ci
npm run build:cached
node scripts/rea.mjs setup --client codex --dry-run --json   # review the plan
node scripts/rea.mjs setup --client codex --yes              # apply
node scripts/rea.mjs doctor --json
cd tallycraft && npm test
```
