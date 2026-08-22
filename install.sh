#!/usr/bin/env bash
# Installs this repo's opencode extensions into the global config directory
# that opencode scans at startup:
#
#   *.ts -> <config>/plugins/*.ts   (auto-loaded plugins)
#   *.md -> <config>/command/*.md   (slash commands; README.md is skipped)
#
# Target directory resolution mirrors opencode itself:
#   $OPENCODE_CONFIG_DIR, else ${XDG_CONFIG_HOME:-~/.config}/opencode
# (opencode uses xdg-basedir, which resolves identically on Linux, macOS,
# and Windows.)
#
# Works on Linux, macOS, and Windows (Git Bash or WSL). Prefers symlinks so
# edits in this repo take effect immediately; falls back to copying when
# symlinks are unavailable (e.g. Windows without Developer Mode). Re-running
# is safe and refreshes existing links/copies in place.

set -euo pipefail

# Make Git Bash fail loudly when native symlinks are unavailable instead of
# silently copying, so the explicit fallback below handles it.
export MSYS=winsymlinks:nativestrict

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-${HOME}/.config}/opencode}"

shopt -s nullglob
plugin_files=("${SRC_DIR}"/*.ts)
command_files=()
for file in "${SRC_DIR}"/*.md; do
	if [ "$(basename "${file}")" != "README.md" ]; then
		command_files+=("${file}")
	fi
done
shopt -u nullglob

if [ "${#plugin_files[@]}" -eq 0 ] && [ "${#command_files[@]}" -eq 0 ]; then
	echo "Nothing to install: no .ts or .md files found in ${SRC_DIR}" >&2
	exit 1
fi

install_file() {
	local src="$1"
	local dst_dir="$2"
	local name dst

	name="$(basename "${src}")"
	dst="${dst_dir}/${name}"

	mkdir -p "${dst_dir}"

	if ln -sfn "${src}" "${dst}" 2>/dev/null; then
		printf 'linked    %s\n' "${dst}"
	else
		# Symlinks unavailable (e.g. Windows without Developer Mode): replace
		# any stale destination and copy instead.
		rm -f "${dst}"
		if cp -f "${src}" "${dst}"; then
			printf 'copied    %s\n' "${dst}"
		else
			printf 'FAILED    %s\n' "${dst}" >&2
			return 1
		fi
	fi
}

printf 'Installing from %s\ninto        %s\n\n' "${SRC_DIR}" "${CONFIG_DIR}"

status=0

for file in "${plugin_files[@]}"; do
	install_file "${file}" "${CONFIG_DIR}/plugins" || status=1
done

for file in "${command_files[@]}"; do
	install_file "${file}" "${CONFIG_DIR}/command" || status=1
done

if [ "${status}" -ne 0 ]; then
	echo >&2
	echo "Some files failed to install." >&2
	exit 1
fi

echo
echo "Done. Restart running opencode sessions to pick up changes."
