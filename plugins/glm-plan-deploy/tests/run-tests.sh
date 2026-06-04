#!/bin/bash

# Deploy Arbitrary Agent Test Script
# Runs full deploy-arbitrary agent flow and verifies deployment result from Claude logs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_CLI="${CLAUDE_CLI:-claude}"
CLAUDE_PROJECTS_DIR="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
AGENT_LOG_AUDIT="${AGENT_LOG_AUDIT:-false}"
AGENT_LOG_AUDIT_MIN_SCORE="${AGENT_LOG_AUDIT_MIN_SCORE:-}"
AGENT_LOG_AUDIT_JSON="${AGENT_LOG_AUDIT_JSON:-false}"
AGENT_LOG_AUDIT_SCORE_PROFILE="${AGENT_LOG_AUDIT_SCORE_PROFILE:-strict}"
AGENT_LOG_AUDIT_FAIL_ON_CHECKS="${AGENT_LOG_AUDIT_FAIL_ON_CHECKS:-}"
DEPLOY_ARBITRARY_FLAGS="${DEPLOY_ARBITRARY_FLAGS:-}"
AUDIT_SCRIPT="$SCRIPT_DIR/../scripts/auditDeployArbitraryAgentLog.js"

# Run mode: "agent" (default), "test" (verify latest log only), or "both" (alias of agent)
RUN_MODE="agent"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

is_enabled() {
    local value="${1:-}"
    value="$(echo "$value" | tr '[:upper:]' '[:lower:]')"
    [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

# Claude resolves the project root by walking upward from `claude -p`'s cwd
# until it finds a `.claude-plugin/` (or other plugin marker) directory. For
# every test project under `plugins/glm-plan-deploy/tests/`, that walk lands
# on the plugin root (`plugins/glm-plan-deploy/`), so every session log lives
# in the SAME Claude project dir regardless of which test project is being
# deployed. Derive the dir directly from the script's location instead of
# from the per-test project path.
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_LOG_DIR_FOR_PLUGIN="$CLAUDE_PROJECTS_DIR/${PLUGIN_DIR//\//-}"

get_project_log_dir() {
    # Argument kept for backward-compat with `audit_agent_log`; ignored.
    echo "$CLAUDE_LOG_DIR_FOR_PLUGIN"
}

# Return the .jsonl in $1 whose mtime is newer than the marker file $2.
# Falls back to the most recent .jsonl that mentions $3 (the target project
# directory) so `-t` mode picks the right session out of a shared dir.
# Picks the single most-recent match to keep multi-file races deterministic.
get_log_file_newer_than() {
    local project_log_dir="$1"
    local marker="${2:-}"
    local project_dir="${3:-}"
    if [[ -n "$marker" && -e "$marker" ]]; then
        find "$project_log_dir" -maxdepth 1 -name "*.jsonl" -type f -newer "$marker" -print 2>/dev/null \
            | xargs -I {} stat -f "%m %N" {} 2>/dev/null \
            | sort -nr \
            | head -n 1 \
            | awk '{$1=""; sub(/^ /,""); print}'
        return
    fi
    if [[ -n "$project_dir" ]]; then
        # Pick the most-recent .jsonl whose prompt mentions this project dir;
        # this disambiguates sessions in the shared plugin-level project dir.
        local candidate
        for candidate in $(ls -1t "$project_log_dir"/*.jsonl 2>/dev/null); do
            if rg -q --fixed-strings -- "$project_dir" "$candidate" 2>/dev/null; then
                echo "$candidate"
                return
            fi
        done
    fi
    ls -1t "$project_log_dir"/*.jsonl 2>/dev/null | head -n 1
}

# Verify deployment outcome by grepping the Claude session log written during
# this invocation. Caller passes the marker file created right before the
# `claude -p` call so we ignore stale logs from previous runs.
verify_deploy_result_from_log() {
    local project_name="$1"
    local project_dir="$2"
    local marker="${3:-}"
    local project_log_dir
    project_log_dir="$(get_project_log_dir "$project_dir")"

    if [[ ! -d "$project_log_dir" ]]; then
        log_error "Claude project log directory not found for $project_name: $project_log_dir"
        log_warn "Set CLAUDE_PROJECTS_DIR if your Claude logs are stored elsewhere"
        return 1
    fi

    local latest_log
    latest_log="$(get_log_file_newer_than "$project_log_dir" "$marker" "$project_dir")"
    if [[ -z "$latest_log" ]]; then
        if [[ -n "$marker" ]]; then
            log_error "No .jsonl log written during this invocation for $project_name in $project_log_dir"
            log_warn "Claude may have written to a different project dir; check CLAUDE_PROJECTS_DIR / the plugin's .claude-plugin marker."
        else
            log_error "No .jsonl logs found for $project_name in $project_log_dir"
        fi
        return 1
    fi

    # Match the authoritative finalReport banner lines emitted by the deploy
    # agent (scripts/arbitrary/templates/{success,failure}.tmpl). The boxed
    # form is:
    #   ║  [OK]   Deployment Completed Successfully  ...  ║
    #   ║  [FAIL] Deployment Failed                  ...  ║
    # Anchoring on the "[OK]   Deployment ..." / "[FAIL] Deployment ..." prefix
    # avoids false positives from agents that READ source files containing
    # the bare phrases (e.g. runDeployArbitraryAgentHeadlessTest.js which
    # uses them as its own detection regex).
    #
    # Fold subagent transcripts in too: the deploy-arbitrary subagent is
    # where the banner is actually emitted; the parent session relays the
    # tool_result which may be present in either file.
    local session_id
    session_id="$(basename "$latest_log" .jsonl)"
    local subagents_dir="$project_log_dir/$session_id/subagents"
    local search_paths=("$latest_log")
    if [[ -d "$subagents_dir" ]]; then
        while IFS= read -r -d '' sub; do
            search_paths+=("$sub")
        done < <(find "$subagents_dir" -maxdepth 1 -name "*.jsonl" -type f -print0 2>/dev/null)
    fi

    local banner_pattern='\[OK\] +Deployment Completed Successfully|\[FAIL\] Deployment Failed'
    local result_line
    result_line="$(rg -o "$banner_pattern" "${search_paths[@]}" 2>/dev/null | tail -n 1 || true)"

    if [[ -z "$result_line" ]]; then
        log_error "Could not determine deployment result from log: $latest_log"
        log_warn "Expected one of '[OK]   Deployment Completed Successfully' or '[FAIL] Deployment Failed' in the session or subagent transcripts"
        log_warn "The deploy-arbitrary agent must relay the finalReport banner verbatim; check that the agent did not paraphrase the result."
        return 1
    fi

    if echo "$result_line" | grep -q '\[OK\]'; then
        log_info "Deployment result verified from log: success ($latest_log)"
        return 0
    fi

    log_error "Deployment result verified from log: failure ($latest_log)"
    log_error "Matched line: $result_line"
    return 1
}

# Audit the Claude agent log written during this invocation (opt-in).
audit_agent_log() {
    local project_name="$1"
    local project_dir="$2"
    local marker="${3:-}"

    if ! is_enabled "$AGENT_LOG_AUDIT"; then
        return 0
    fi

    log_step "Auditing deploy-arbitrary agent log for $project_name..."

    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js is required for AGENT_LOG_AUDIT but was not found"
        return 1
    fi

    if [[ ! -f "$AUDIT_SCRIPT" ]]; then
        log_error "Audit script not found: $AUDIT_SCRIPT"
        return 1
    fi

    local project_log_dir
    project_log_dir="$(get_project_log_dir "$project_dir")"
    if [[ ! -d "$project_log_dir" ]]; then
        log_error "Claude project log directory not found for $project_name: $project_log_dir"
        log_warn "Set CLAUDE_PROJECTS_DIR if your Claude logs are stored elsewhere"
        return 1
    fi

    # The audit script accepts either a directory (picks newest by mtime) or
    # a specific .jsonl file. Pass the file written during this run so
    # back-to-back projects don't all score against the same dir's newest log.
    local audit_target="$project_log_dir"
    local log_file
    log_file="$(get_log_file_newer_than "$project_log_dir" "$marker" "$project_dir")"
    if [[ -n "$log_file" && -f "$log_file" ]]; then
        audit_target="$log_file"
    fi

    local audit_cmd=(node "$AUDIT_SCRIPT")
    if [[ -n "$AGENT_LOG_AUDIT_SCORE_PROFILE" ]]; then
        audit_cmd+=(--score-profile "$AGENT_LOG_AUDIT_SCORE_PROFILE")
    fi
    if [[ -n "$AGENT_LOG_AUDIT_MIN_SCORE" ]]; then
        audit_cmd+=(--min-score "$AGENT_LOG_AUDIT_MIN_SCORE")
    fi
    if [[ -n "$AGENT_LOG_AUDIT_FAIL_ON_CHECKS" ]]; then
        audit_cmd+=(--fail-on-check "$AGENT_LOG_AUDIT_FAIL_ON_CHECKS")
    fi
    audit_cmd+=("$audit_target")

    if ! "${audit_cmd[@]}"; then
        log_error "Agent log audit failed for $project_name"
        return 1
    fi

    if is_enabled "$AGENT_LOG_AUDIT_JSON"; then
        local audit_json_path="$project_dir/agent-log-audit.json"
        local audit_json_cmd=(node "$AUDIT_SCRIPT" --json)
        if [[ -n "$AGENT_LOG_AUDIT_SCORE_PROFILE" ]]; then
            audit_json_cmd+=(--score-profile "$AGENT_LOG_AUDIT_SCORE_PROFILE")
        fi
        if [[ -n "$AGENT_LOG_AUDIT_FAIL_ON_CHECKS" ]]; then
            audit_json_cmd+=(--fail-on-check "$AGENT_LOG_AUDIT_FAIL_ON_CHECKS")
        fi
        audit_json_cmd+=("$audit_target")
        if "${audit_json_cmd[@]}" > "$audit_json_path"; then
            log_info "Saved audit JSON: $audit_json_path"
        else
            log_warn "Failed to save audit JSON report for $project_name"
        fi
    fi

    log_info "Agent log audit passed for $project_name"
    return 0
}

# Run deploy-arbitrary agent for a project
run_agent() {
    local project_name="$1"
    local project_dir="$SCRIPT_DIR/$project_name"

    log_step "Running deploy-arbitrary agent for $project_name..."

    # Check if Claude CLI is available (extract first word for command check)
    local cli_cmd
    cli_cmd=$(echo "$CLAUDE_CLI" | awk '{print $1}')
    if ! command -v "$cli_cmd" &>/dev/null; then
        log_error "Claude CLI not found: $cli_cmd"
        log_warn "Set CLAUDE_CLI environment variable to specify the path"
        return 1
    fi

    # Run the full deploy agent in print mode.
    # Use eval to properly handle CLAUDE_CLI with multiple arguments (e.g., "claude --model opus --settings settings.json")
    # Pass the project directory explicitly in the prompt to ensure correct file paths.
    log_info "Invoking: $CLAUDE_CLI -p with project_dir=$project_dir --run-test"

    local deploy_command="/glm-plan-deploy:deploy-arbitrary --run-test"
    if [[ -n "$DEPLOY_ARBITRARY_FLAGS" ]]; then
        deploy_command="$deploy_command $DEPLOY_ARBITRARY_FLAGS"
    fi

    local agent_prompt="$deploy_command

Deploy the project located at: $project_dir

IMPORTANT: All file operations (reading source files, creating Dockerfiles, packaging, upload, verification) must use this absolute path."

    # Mark "now" right before invoking Claude so verify_deploy_result_from_log
    # picks only the .jsonl written during this run (multiple test projects
    # share the same plugin-level Claude project dir).
    local marker
    marker="$(mktemp -t run-tests-marker.XXXXXX)"

    if ! eval "$CLAUDE_CLI -p \"\$agent_prompt\""; then
        log_error "Agent failed for $project_name"
        rm -f "$marker"
        return 1
    fi

    if ! verify_deploy_result_from_log "$project_name" "$project_dir" "$marker"; then
        rm -f "$marker"
        return 1
    fi

    if ! audit_agent_log "$project_name" "$project_dir" "$marker"; then
        rm -f "$marker"
        return 1
    fi

    rm -f "$marker"
    log_info "Agent completed successfully for $project_name"
    return 0
}

# Process a single project based on run mode
process_project() {
    local project_name="$1"
    local project_dir="$SCRIPT_DIR/$project_name"

    echo ""
    echo "========================================"
    log_info "Processing: $project_name (mode: $RUN_MODE)"
    echo "========================================"

    # Check project directory exists
    if [[ ! -d "$project_dir" ]]; then
        log_error "Project directory not found: $project_dir"
        return 1
    fi

    case "$RUN_MODE" in
        agent)
            run_agent "$project_name"
            ;;
        test)
            verify_deploy_result_from_log "$project_name" "$project_dir"
            ;;
        both)
            run_agent "$project_name"
            ;;
    esac
}

# Show usage
show_usage() {
    echo "Usage: $0 [OPTIONS] [project_name|all]"
    echo ""
    echo "Run Modes (mutually exclusive):"
    echo "  -a, --agent-only    Run full deploy agent and verify result from log (default)"
    echo "  -t, --test-only     Only verify latest deployment result from log"
    echo "  -b, --both          Alias of --agent-only (kept for compatibility)"
    echo ""
    echo "Commands:"
    echo "  (none)              Process all projects"
    echo "  all                 Process all projects (explicit)"
    echo "  <project>           Process specific project (e.g., python-flask)"
    echo ""
    echo "Environment Variables:"
    echo "  CLAUDE_CLI            Claude CLI command (default: claude)"
    echo "  AGENT_LOG_AUDIT       Enable post-agent log audit (true|false, default: false)"
    echo "  AGENT_LOG_AUDIT_MIN_SCORE  Fail if audit score is below threshold (0-100)"
    echo "  AGENT_LOG_AUDIT_JSON  Save JSON audit report to <project>/agent-log-audit.json"
    echo "  AGENT_LOG_AUDIT_SCORE_PROFILE  Audit score profile (strict|balanced, default: strict)"
    echo "  AGENT_LOG_AUDIT_FAIL_ON_CHECKS Fail if listed check IDs are FAIL (comma-separated)"
    echo "  DEPLOY_ARBITRARY_FLAGS Extra flags appended to /glm-plan-deploy:deploy-arbitrary"
    echo "  CLAUDE_PROJECTS_DIR   Claude projects log root (default: ~/.claude/projects)"
    echo ""
    echo "Available projects:"
    echo "  python-flask, nodejs-express, go-http, java-spring,"
    echo "  ruby-sinatra, php-simple, rust-actix"
    echo ""
    echo "Database fixture projects (not included in default 'all'):"
    echo "  nodejs-prisma-mysql, python-flask-postgres, java-spring-mysql"
    echo "  Pass a project explicitly and provide the database mode/env expected by that fixture."
    echo ""
    echo "Examples:"
    echo "  $0                              # Run full deploy + log verification for all projects"
    echo "  $0 -a python-flask              # Run full deploy for python-flask"
    echo "  $0 --test-only go-http          # Verify latest go-http deployment result from log"
    echo "  $0 -b java-spring               # Alias of -a for java-spring"
    echo "  CLAUDE_CLI=/path/to/claude $0   # Use custom Claude CLI path"
    echo "  AGENT_LOG_AUDIT=true AGENT_LOG_AUDIT_MIN_SCORE=70 $0 -a ruby-sinatra"
    echo "  AGENT_LOG_AUDIT=true AGENT_LOG_AUDIT_FAIL_ON_CHECKS=cnb_status_on_fail $0 -a ruby-sinatra"
    echo "  DEPLOY_ARBITRARY_FLAGS='--databaseMode managed' $0 -a nodejs-prisma-mysql"
    exit 0
}

# Parse command line arguments
# Sets global: RUN_MODE, POSITIONAL_ARGS
parse_args() {
    POSITIONAL_ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -a|--agent-only)
                RUN_MODE="agent"
                shift
                ;;
            -t|--test-only)
                RUN_MODE="test"
                shift
                ;;
            -b|--both)
                RUN_MODE="both"
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                POSITIONAL_ARGS+=("$1")
                shift
                ;;
        esac
    done
}

# Main
main() {
    # Parse arguments (sets RUN_MODE and POSITIONAL_ARGS)
    parse_args "$@"
    # Guard the empty-array expansion: macOS ships Bash 3.2, where
    # "${arr[@]}" under `set -u` is an unbound-variable error when the
    # array is empty (the no-project "all" path). The ${arr[@]+...} form
    # expands to nothing safely on 3.2 and behaves identically on 4.4+.
    set -- ${POSITIONAL_ARGS[@]+"${POSITIONAL_ARGS[@]}"}

    echo "========================================"
    echo "Deploy Arbitrary Agent Test Suite"
    echo "========================================"
    echo "Run Mode: $RUN_MODE"
    echo "Claude CLI: $CLAUDE_CLI"
    echo "Agent Log Audit: $AGENT_LOG_AUDIT"
    if [[ -n "$AGENT_LOG_AUDIT_MIN_SCORE" ]]; then
        echo "Agent Log Audit Min Score: $AGENT_LOG_AUDIT_MIN_SCORE"
    fi
    if [[ -n "$AGENT_LOG_AUDIT_SCORE_PROFILE" ]]; then
        echo "Agent Log Audit Score Profile: $AGENT_LOG_AUDIT_SCORE_PROFILE"
    fi
    if [[ -n "$AGENT_LOG_AUDIT_FAIL_ON_CHECKS" ]]; then
        echo "Agent Log Audit Fail-On-Checks: $AGENT_LOG_AUDIT_FAIL_ON_CHECKS"
    fi
    echo ""

    # Keep database fixtures out of the default suite because they require an
    # explicit databaseMode choice or an external database service.
    local projects=("python-flask" "nodejs-express" "go-http" "java-spring" "ruby-sinatra" "php-simple" "rust-actix")
    local passed=0
    local failed=0
    local processed=()

    # Handle special commands
    if [[ -n "${1:-}" ]]; then
        case "$1" in
            all)
                # Process all projects (default behavior)
                ;;
            *)
                # Process specific project
                projects=("$1")
                ;;
        esac
    fi

    local total_projects=${#projects[@]}
    for project in "${projects[@]}"; do
        if process_project "$project"; then
            ((passed++))
            processed+=("$project ✅")
        else
            ((failed++))
            processed+=("$project ❌")
            # In single-project mode keep the original fast-stop semantics
            # (one iteration, the message is meaningful). In multi-project
            # mode keep going so the summary covers every project; the exit
            # code at the end is still 1 if any failed.
            if [[ "$total_projects" -le 1 ]]; then
                log_error "Stopping due to failure"
                break
            fi
            log_warn "Project '$project' failed; continuing with remaining projects."
        fi
    done

    echo ""
    echo "========================================"
    if [[ $failed -eq 0 ]]; then
        log_info "All projects completed successfully!"
    else
        log_error "Some projects failed!"
    fi
    echo "========================================"
    echo "Mode: $RUN_MODE"
    echo "Results: $passed passed, $failed failed"
    echo ""
    echo "Processed projects:"
    for result in "${processed[@]}"; do
        echo "  - $result"
    done
    echo ""

    if [[ $failed -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
