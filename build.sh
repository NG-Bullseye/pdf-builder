#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/out"
CSS="$SCRIPT_DIR/style.css"
TMP_HTML="/tmp/pdf-builder-$(date +%s).html"

usage() {
    echo "Usage: build.sh <input.md> [--logo /path/to/logo.png]"
    exit 1
}

[[ $# -lt 1 ]] && usage

INPUT="$1"
LOGO="${LOGO:-}"
shift

while [[ $# -gt 0 ]]; do
    case "$1" in
        --logo) LOGO="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

[[ ! -f "$INPUT" ]] && { echo "File not found: $INPUT"; exit 1; }

BASENAME="$(basename "$INPUT" .md)"
OUTPUT="$OUT_DIR/${BASENAME}.pdf"
mkdir -p "$OUT_DIR"

# Build logo HTML snippet (absolute file:// path required by WeasyPrint)
if [[ -n "$LOGO" && -f "$LOGO" ]]; then
    ABS_LOGO="$(cd "$(dirname "$LOGO")" && pwd)/$(basename "$LOGO")"
    LOGO_HTML='<div id="page-logo"><img src="file://'"$ABS_LOGO"'" alt="Logo"></div>'
else
    LOGO_HTML=""
fi

# Convert MD -> HTML (pandoc handles tables, GFM, etc.)
pandoc "$INPUT" \
    --from gfm \
    --to html5 \
    --standalone \
    --css "$CSS" \
    --template "$SCRIPT_DIR/template.html" \
    --variable logo_html="$LOGO_HTML" \
    -o "$TMP_HTML"

# Convert HTML -> PDF
weasyprint "$TMP_HTML" "$OUTPUT"

rm -f "$TMP_HTML"
echo "PDF: $OUTPUT"
