#!/bin/sh
set -eu

ACCESS_CONTROL_DIR="${ZAI_NGINX_ACCESS_CONTROL_DIR:-/tmp/cc-deploy}"
REAL_IP_CONF="${ZAI_NGINX_REAL_IP_CONF_PATH:-${ACCESS_CONTROL_DIR}/nginx-real-ip.conf}"
ACCESS_CONF="${ZAI_NGINX_ACCESS_CONF_PATH:-${ACCESS_CONTROL_DIR}/nginx-access-control.conf}"

mkdir -p "$ACCESS_CONTROL_DIR"

is_access_control_enabled() {
    case "${ZAI_ACCESS_CONTROL_ENABLED:-}" in
        true|TRUE|1|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

decode_base64_directives() {
    env_name="$1"
    output_path="$2"
    required="$3"

    value="$(eval "printf '%s' \"\${${env_name}:-}\"")"
    if [ -n "$value" ]; then
        if ! printf '%s' "$value" | base64 -d > "$output_path"; then
            echo "nginx-access-control: failed to decode ${env_name}" >&2
            exit 1
        fi
        return
    fi

    if [ "$required" = "1" ]; then
        echo "nginx-access-control: ${env_name} is required when access control is enabled" >&2
        exit 1
    fi

    : > "$output_path"
}

if is_access_control_enabled; then
    decode_base64_directives "ZAI_NGINX_REAL_IP_DIRECTIVES_B64" "$REAL_IP_CONF" "1"
    decode_base64_directives "ZAI_NGINX_ACCESS_DIRECTIVES_B64" "$ACCESS_CONF" "1"
else
    decode_base64_directives "ZAI_NGINX_REAL_IP_DIRECTIVES_B64" "$REAL_IP_CONF" "0"
    decode_base64_directives "ZAI_NGINX_ACCESS_DIRECTIVES_B64" "$ACCESS_CONF" "0"
fi

